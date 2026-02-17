using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace ClipShare.Services
{
    public class ClipGenerator
    {
        private readonly ILogger<ClipGenerator> _logger;

        public ClipGenerator(ILogger<ClipGenerator> logger)
        {
            _logger = logger;
        }

        public async Task GenerateClip(string input, string output, double start, double end)
        {
            var duration = end - start;

            // Use Jellyfin's ffmpeg if available, otherwise fallback to system ffmpeg
            var ffmpegPath = "/usr/lib/jellyfin-ffmpeg/ffmpeg";
            if (!File.Exists(ffmpegPath))
            {
                ffmpegPath = "ffmpeg";
            }

            // Ensure output directory exists and is writable
            var outputDir = Path.GetDirectoryName(output);
            if (!string.IsNullOrEmpty(outputDir))
            {
                Directory.CreateDirectory(outputDir);
                _logger.LogInformation("[ClipShare] Output directory: {Dir}", outputDir);
            }

            // Check input file
            if (!File.Exists(input))
            {
                throw new Exception($"Input file not found: {input}");
            }

            // Use -ss before -i for fast seeking, then -t for duration
            // -c copy for stream copy (fast, no re-encoding)
            var args = $"-ss {start:F2} -t {duration:F2} -i \"{input}\" -c copy -avoid_negative_ts make_zero \"{output}\"";

            _logger.LogInformation("[ClipShare] Running: {Ffmpeg} {Args}", ffmpegPath, args);

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
            var error = errorOutput.ToString();

            _logger.LogInformation("[ClipShare] FFmpeg exit code: {Code}", exitCode);

            if (exitCode != 0)
            {
                _logger.LogError("[ClipShare] FFmpeg error output: {Error}", error);
                throw new Exception($"FFmpeg failed with exit code {exitCode}");
            }

            if (!File.Exists(output))
            {
                throw new Exception("FFmpeg completed but output file was not created");
            }

            _logger.LogInformation("[ClipShare] Clip created successfully: {Output}", output);
        }
    }
}
