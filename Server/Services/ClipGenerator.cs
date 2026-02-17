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

            // Use Jellyfin's ffmpeg if available, otherwise fallback to system ffmpeg
            var ffmpegPath = "/usr/lib/jellyfin-ffmpeg/ffmpeg";
            if (!File.Exists(ffmpegPath))
            {
                ffmpegPath = "ffmpeg";
            }

            // Use -ss before -i for fast seeking, then -t for duration
            // -c copy for stream copy (fast, no re-encoding)
            var args = $"-ss {start:F2} -t {duration:F2} -i \"{input}\" -c copy -avoid_negative_ts make_zero \"{output}\"";

            Console.WriteLine($"[ClipShare] Running: {ffmpegPath} {args}");

            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = ffmpegPath,
                    Arguments = args,
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            var errorOutput = new System.Text.StringBuilder();
            var standardOutput = new System.Text.StringBuilder();

            process.ErrorDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                    errorOutput.AppendLine(e.Data);
            };

            process.OutputDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                    standardOutput.AppendLine(e.Data);
            };

            process.Start();
            process.BeginErrorReadLine();
            process.BeginOutputReadLine();

            await process.WaitForExitAsync();

            var exitCode = process.ExitCode;

            if (exitCode != 0)
            {
                var error = errorOutput.ToString();
                Console.WriteLine($"[ClipShare] FFmpeg exit code: {exitCode}");
                Console.WriteLine($"[ClipShare] FFmpeg error: {error}");
                throw new Exception($"FFmpeg failed with exit code {exitCode}: {error.Substring(0, Math.Min(500, error.Length))}");
            }

            if (!File.Exists(output))
            {
                throw new Exception("FFmpeg completed but output file was not created");
            }

            Console.WriteLine($"[ClipShare] Clip created successfully: {output}");
        }
    }
}
