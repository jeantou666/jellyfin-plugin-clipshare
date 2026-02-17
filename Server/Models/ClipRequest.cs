namespace ClipShare.Models
{
    public class ClipRequest
    {
        public string ItemId { get; set; } = "";
        public string? MediaPath { get; set; }
        public double StartSeconds { get; set; }
        public double EndSeconds { get; set; }
        public int ExpireHours { get; set; }
    }
}
