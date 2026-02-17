using System;

namespace ClipShare.Models
{
    public class ClipInfo
    {
        public string Id { get; set; } = "";
        public string FilePath { get; set; } = "";
        public DateTime ExpirationDate { get; set; }
    }
}
