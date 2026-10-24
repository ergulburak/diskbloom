// Diskbloom fast scanner.
// Walks a directory tree with FindFirstFileExW on several threads and streams
// the result to stdout as UTF-8 lines, one block per directory:
//   D \t id \t parentId \t name        a sub-directory (id is new, parent already sent)
//   F \t parentId \t size \t name      a file
//   E \t parentId                      the directory could not be read
//   X                                  the scan is complete
// A directory's block is written only after its parent's block, and sub-directories
// are queued only after the block that announces them is written, so a reader
// never sees an id before its D line.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Scanner
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 4)]
    struct WIN32_FIND_DATAW
    {
        public uint dwFileAttributes;
        public long ftCreationTime, ftLastAccessTime, ftLastWriteTime;
        public uint nFileSizeHigh, nFileSizeLow, dwReserved0, dwReserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string cFileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string cAlternateFileName;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr FindFirstFileExW(string lpFileName, int fInfoLevelId, out WIN32_FIND_DATAW lpFindFileData,
        int fSearchOp, IntPtr lpSearchFilter, int dwAdditionalFlags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool FindNextFileW(IntPtr hFindFile, out WIN32_FIND_DATAW lpFindFileData);

    [DllImport("kernel32.dll")]
    static extern bool FindClose(IntPtr hFindFile);

    const int FindExInfoBasic = 1;
    const int FIND_FIRST_EX_LARGE_FETCH = 2;
    const uint ATTR_DIRECTORY = 0x10;
    const uint ATTR_REPARSE_POINT = 0x400;
    const uint NAME_SURROGATE = 0x20000000; // reparse tag bit: the entry points somewhere else
    static readonly IntPtr INVALID = new IntPtr(-1);

    struct Job { public int Id; public string Path; }

    static readonly BlockingCollection<Job> queue = new BlockingCollection<Job>();
    static readonly object outLock = new object();
    static Stream stdout;
    static int nextId = 1;
    static int pending = 1;

    static int Main(string[] args)
    {
        if (args.Length < 1) { Console.Error.WriteLine("usage: scanner <root>"); return 2; }
        string root = args[0].TrimEnd('\\') + "\\";
        int threads = args.Length > 1 ? int.Parse(args[1]) : Math.Max(4, Math.Min(16, Environment.ProcessorCount * 2));
        stdout = new BufferedStream(Console.OpenStandardOutput(), 1 << 16);

        queue.Add(new Job { Id = 0, Path = root });
        // Push partial output out regularly so a slow drive still shows progress.
        var flusher = new Timer(_ => { lock (outLock) { stdout.Flush(); } }, null, 250, 250);
        var workers = new List<Thread>();
        for (int i = 0; i < threads; i++)
        {
            var t = new Thread(Work) { IsBackground = true };
            t.Start();
            workers.Add(t);
        }
        foreach (var t in workers) t.Join();
        flusher.Dispose();
        lock (outLock)
        {
            var x = Encoding.UTF8.GetBytes("X\n");
            stdout.Write(x, 0, x.Length);
            stdout.Flush();
        }
        return 0;
    }

    static void Work()
    {
        var sb = new StringBuilder(1 << 14);
        var subs = new List<Job>();
        foreach (var job in queue.GetConsumingEnumerable())
        {
            sb.Clear();
            subs.Clear();
            Scan(job, sb, subs);
            var bytes = Encoding.UTF8.GetBytes(sb.ToString());
            lock (outLock) { stdout.Write(bytes, 0, bytes.Length); }
            Interlocked.Add(ref pending, subs.Count);
            foreach (var s in subs) queue.Add(s);
            if (Interlocked.Decrement(ref pending) == 0) queue.CompleteAdding();
        }
    }

    static void Scan(Job job, StringBuilder sb, List<Job> subs)
    {
        string pattern = @"\\?\" + job.Path + "*";
        WIN32_FIND_DATAW fd;
        IntPtr h = FindFirstFileExW(pattern, FindExInfoBasic, out fd, 0, IntPtr.Zero, FIND_FIRST_EX_LARGE_FETCH);
        if (h == INVALID) { sb.Append("E\t").Append(job.Id).Append('\n'); return; }
        try
        {
            do
            {
                string name = fd.cFileName;
                if (name == "." || name == "..") continue;
                if ((fd.dwFileAttributes & ATTR_DIRECTORY) != 0)
                {
                    // Junctions, mount points and directory symlinks point into other parts of the
                    // tree ("name surrogate" reparse tags); skip them so nothing is counted twice.
                    // Other reparse folders, such as OneDrive cloud folders, are real and are walked.
                    if ((fd.dwFileAttributes & ATTR_REPARSE_POINT) != 0 && (fd.dwReserved0 & NAME_SURROGATE) != 0) continue;
                    int id = Interlocked.Increment(ref nextId);
                    sb.Append("D\t").Append(id).Append('\t').Append(job.Id).Append('\t').Append(name).Append('\n');
                    subs.Add(new Job { Id = id, Path = job.Path + name + "\\" });
                }
                else
                {
                    long size = ((long)fd.nFileSizeHigh << 32) | fd.nFileSizeLow;
                    sb.Append("F\t").Append(job.Id).Append('\t').Append(size).Append('\t').Append(name).Append('\n');
                }
            } while (FindNextFileW(h, out fd));
        }
        finally { FindClose(h); }
    }
}
