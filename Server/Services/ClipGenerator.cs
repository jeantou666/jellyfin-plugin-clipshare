using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

namespace ClipShare.Services
{
    public class ClipGenerator
    {
        public async Task GenerateClip(string input, string output, double start, double end)
        {
            var duration = end - start;

            var args = $"-ss {start} -t {duration} -i \"{input}\" -c copy -avoid_negative_ts make_zero \"{output}\"";

            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "ffmpeg",
                    Arguments = args,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            process.Start();
            await process.WaitForExitAsync();

            if (!File.Exists(output))
                throw new Exception("FFmpeg failed to generate clip");
        }
    }
}
