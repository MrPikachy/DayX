document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("send-comment");

    if (btn) {
        btn.addEventListener("click", async () => {
            // 1. Отримуємо ID форуму з data-атрибута кнопки
            const forumId = btn.getAttribute("data-forum-id");

            const input = document.getElementById("comment-input");
            const text = input.value;

            if (!text) return;

            // Зберігаємо оригінальний текст кнопки
            const originalText = btn.innerText;

            // Ефект завантаження
            btn.innerText = "Відправка...";
            btn.disabled = true;

            try {
                const res = await fetch(`/api/forum/${forumId}/comment`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ comment: text })
                });

                if (res.ok) {
                    location.reload();
                } else {
                    alert("Помилка відправки");
                    btn.innerText = originalText;
                    btn.disabled = false;
                }
            } catch (e) {
                console.error(e);
                alert("Помилка з'єднання");
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });
    }
});