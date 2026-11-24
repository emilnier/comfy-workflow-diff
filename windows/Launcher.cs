using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows.Forms;

[assembly: AssemblyTitle("ComfyUI Workflow Diff")]
[assembly: AssemblyProduct("ComfyUI Workflow Diff")]
[assembly: AssemblyVersion("1.4.0.0")]

internal static class Launcher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string page;
            try
            {
                page = PreparePage(Path.GetTempPath());
            }
            catch (UnauthorizedAccessException)
            {
                page = PreparePage(AppDomain.CurrentDomain.BaseDirectory);
            }
            foreach (string folder in new[] { "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA" })
            {
                string root = Environment.GetEnvironmentVariable(folder);
                if (String.IsNullOrEmpty(root)) continue;
                foreach (string relative in new[] { @"Google\Chrome\Application\chrome.exe", @"Microsoft\Edge\Application\msedge.exe" })
                {
                    string browser = Path.Combine(root, relative);
                    if (!File.Exists(browser)) continue;
                    Process.Start(new ProcessStartInfo(browser, "--app=\"" + new Uri(page).AbsoluteUri + "\" --window-size=1600,1000")
                    {
                        UseShellExecute = false
                    });
                    return 0;
                }
            }
            Process.Start(new ProcessStartInfo(page) { UseShellExecute = true });
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "ComfyUI Workflow Diff", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string PreparePage(string parent)
    {
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("index.html"))
        using (var sha = SHA256.Create())
        {
            string hash = BitConverter.ToString(sha.ComputeHash(resource)).Replace("-", "");
            string directory = Path.Combine(parent, "ComfyWorkflowDiff");
            Directory.CreateDirectory(directory);
            string page = Path.Combine(directory, hash + ".html");
            if (Matches(page, sha, hash)) return page;

            string temporary = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                resource.Position = 0;
                using (var output = File.Create(temporary)) resource.CopyTo(output);
                if (File.Exists(page)) File.Replace(temporary, page, null);
                else File.Move(temporary, page);
            }
            catch (IOException)
            {
                // A simultaneous launch may already have installed the same page.
                if (!Matches(page, sha, hash)) throw;
            }
            finally
            {
                File.Delete(temporary);
            }
            return page;
        }
    }

    private static bool Matches(string path, HashAlgorithm sha, string expected)
    {
        if (!File.Exists(path)) return false;
        using (var input = File.OpenRead(path))
            return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "") == expected;
    }
}
