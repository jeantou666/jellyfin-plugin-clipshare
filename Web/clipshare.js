(function () {

    function addButton() {
        const controls = document.querySelector(".videoOsdBottom .osdControls");
        if (!controls || document.getElementById("clipshare-btn")) return;

        const btn = document.createElement("button");
        btn.id = "clipshare-btn";
        btn.className = "osdControlButton";
        btn.innerHTML = "✂️ Clip";

        btn.onclick = async () => {
            const video = document.querySelector("video");
            if (!video) return alert("Video not found");

            const start = prompt("Start time (seconds):", Math.floor(video.currentTime));
            if (start === null) return;

            const end = prompt("End time (seconds):", Math.floor(video.currentTime + 10));
            if (end === null) return;

            const expire = prompt("Expiration hours (default 72):", "72");

            const itemId = window.ApiClient._serverInfo.ItemId;

            const res = await fetch("/ClipShare/Create", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    itemId: itemId,
                    startSeconds: parseFloat(start),
                    endSeconds: parseFloat(end),
                    expireHours: parseInt(expire)
                })
            });

            const data = await res.json();
            prompt("Clip URL (copy):", data.url);
        };

        controls.appendChild(btn);
    }

    setInterval(addButton, 2000);

})();
