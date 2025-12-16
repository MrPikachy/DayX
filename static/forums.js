document.addEventListener("DOMContentLoaded", () => {
    const createBtn = document.getElementById("create-forum-btn");
    const modal = document.getElementById("modal-create-forum");
    const cancelBtn = document.getElementById("cancel-forum");
    const saveBtn = document.getElementById("save-forum");
    const overlay = document.querySelector(".modal-overlay");

    // Відкриття модалки
    if (createBtn && modal) {
        createBtn.addEventListener("click", () => {
            modal.classList.remove("hidden");
        });
    }

    // Закриття кнопкою "Скасувати"
    if (cancelBtn && modal) {
        cancelBtn.addEventListener("click", () => {
            modal.classList.add("hidden");
        });
    }

    // Закриття при кліку по фону
    if (overlay && modal) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                modal.classList.add("hidden");
            }
        });
    }

    // Збереження (Створення форуму)
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const titleInput = document.getElementById("forum-title");
            const descInput = document.getElementById("forum-description");
            const anonInput = document.getElementById("forum-anonymous");

            const title = titleInput.value;
            const desc = descInput.value;
            const isAnon = anonInput.checked;

            if(!title) {
                alert("Введіть тему");
                return;
            }

            // Блокуємо кнопку, щоб не натиснули двічі
            saveBtn.disabled = true;
            saveBtn.innerText = "Створення...";

            try {
                const res = await fetch("/api/forum", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({
                        title: title,
                        description: desc,
                        is_anonymous: isAnon ? 1 : 0
                    })
                });

                if(res.ok) {
                    location.reload();
                } else {
                    alert("Помилка створення форуму");
                    saveBtn.disabled = false;
                    saveBtn.innerText = "Створити";
                }
            } catch (err) {
                console.error(err);
                alert("Помилка з'єднання");
                saveBtn.disabled = false;
                saveBtn.innerText = "Створити";
            }
        });
    }
});