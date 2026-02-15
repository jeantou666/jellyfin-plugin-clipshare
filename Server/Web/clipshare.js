(function () {

    function waitPlayer() {
        const interval = setInterval(() => {
            const video = document.querySelector('video');
            if (!video) return;

            clearInterval(interval);
            addButton(video);
        }, 1000);
    }

    function addButton(video) {

        if (document.getElementById("clipshare-btn")) return;

        const btn = document.createElement("button");
        btn.id = "clipshare-btn";
        btn.innerText = "🎬 Clip";
        btn.style.position = "absolute";
        btn.style.bottom = "80px";
        btn.style.right = "20px";
        btn.style.zIndex = 9999;
        btn.style.padding = "10px";

        let start = null;

        btn.onclick = async () => {
            if (start === null) {
                start = video.currentTime;
                btn.innerText = "⏹ End";
            } else {
                const end = video.currentTime;

                const itemId = ApiClient._currentPlayer._currentItem.Id;

                const res = await fetch(`/ClipShare/create`, {
                    method: "POST",
                    headers: {"Content-Type":"application/json"},
                    body: JSON.stringify({
                        itemId: itemId,
                        start: start,
                        end: end
                    })
                });

                const data = await res.json();
                navigator.clipboard.writeText(data.url);

                alert("Lien copié !");
                start = null;
                btn.innerText = "🎬 Clip";
            }
        };

        document.body.appendChild(btn);
    }

    waitPlayer();

})();
