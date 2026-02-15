console.log("ClipShare loaded");

document.addEventListener("viewshow", function (e) {
    if (!e.detail || e.detail.contextPath !== "/video") return;

    const interval = setInterval(() => {
        const controls = document.querySelector(".videoOsdBottom");
        if (!controls) return;

        if (document.getElementById("clipshare-btn")) {
            clearInterval(interval);
            return;
        }

        const btn = document.createElement("button");
        btn.id = "clipshare-btn";
        btn.innerText = "✂ Clip";
        btn.className = "raised button-submit";

        btn.onclick = () => alert("CLIP BUTTON WORKS");

        controls.appendChild(btn);
        clearInterval(interval);
    }, 500);
});
