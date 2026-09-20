using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

internal static class Program
{
    private static readonly IntPtr HwndTopmost = new IntPtr(-1);
    private static readonly IntPtr HwndNotTopmost = new IntPtr(-2);
    private const uint SwpNoMoveNoSizeShow = 0x43;

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint from, uint to, bool attach);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(
        IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 1) return 2;
        string target;
        try { target = Path.GetFullPath(args[0]).TrimEnd('\\'); }
        catch { return 2; }

        Type shellType = Type.GetTypeFromProgID("Shell.Application");
        if (shellType == null) return 3;
        dynamic shell = Activator.CreateInstance(shellType);
        DateTime deadline = DateTime.UtcNow.AddSeconds(5);

        do
        {
            IntPtr candidate = IntPtr.Zero;
            try
            {
                dynamic windows = shell.Windows();
                int count = windows.Count;
                for (int i = 0; i < count; i++)
                {
                    try
                    {
                        dynamic window = windows.Item(i);
                        string executable = Convert.ToString(window.FullName);
                        if (!executable.EndsWith("\\explorer.exe", StringComparison.OrdinalIgnoreCase)) continue;
                        string folder = Path.GetFullPath(Convert.ToString(window.Document.Folder.Self.Path)).TrimEnd('\\');
                        if (!string.Equals(folder, target, StringComparison.OrdinalIgnoreCase)) continue;
                        candidate = new IntPtr(Convert.ToInt64(window.HWND));
                    }
                    catch { }
                }
            }
            catch { }

            if (candidate != IntPtr.Zero)
            {
                IntPtr previous = GetForegroundWindow();
                Focus(candidate);
                DateTime guardDeadline = DateTime.UtcNow.AddSeconds(3);
                while (DateTime.UtcNow < guardDeadline)
                {
                    Thread.Sleep(250);
                    IntPtr current = GetForegroundWindow();
                    if (current == candidate) continue;
                    // Correct only Windows restoring the exact window that was in
                    // front before the click. A user-selected third window stops us.
                    if (current != previous) break;
                    Focus(candidate);
                }
                return 0;
            }
            Thread.Sleep(120);
        }
        while (DateTime.UtcNow < deadline);

        return 1;
    }

    private static void Focus(IntPtr window)
    {
        IntPtr foreground = GetForegroundWindow();
        uint ignored;
        uint targetThread = GetWindowThreadProcessId(window, out ignored);
        uint foregroundThread = GetWindowThreadProcessId(foreground, out ignored);
        uint currentThread = GetCurrentThreadId();

        if (foregroundThread != 0 && foregroundThread != currentThread)
            AttachThreadInput(currentThread, foregroundThread, true);
        if (targetThread != 0 && targetThread != currentThread)
            AttachThreadInput(currentThread, targetThread, true);

        try
        {
            // A synthetic Alt press grants this user-initiated helper permission to
            // switch the foreground window under Windows' focus-stealing rules.
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, 2, UIntPtr.Zero);
            ShowWindowAsync(window, 9);
            SetWindowPos(window, HwndTopmost, 0, 0, 0, 0, SwpNoMoveNoSizeShow);
            BringWindowToTop(window);
            SetActiveWindow(window);
            SetFocus(window);
            SetForegroundWindow(window);
            Thread.Sleep(250);
            SetWindowPos(window, HwndNotTopmost, 0, 0, 0, 0, SwpNoMoveNoSizeShow);
            SetForegroundWindow(window);
        }
        finally
        {
            if (targetThread != 0 && targetThread != currentThread)
                AttachThreadInput(currentThread, targetThread, false);
            if (foregroundThread != 0 && foregroundThread != currentThread)
                AttachThreadInput(currentThread, foregroundThread, false);
        }
        Thread.Sleep(100);
    }
}
