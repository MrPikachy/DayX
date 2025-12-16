document.addEventListener("DOMContentLoaded", () => {
    // Ініціалізація іконок
    lucide.createIcons();

    const notifBtn = document.getElementById("notifications-btn");
    const notifModal = document.getElementById("notifications-modal");
    const closeBtn = document.querySelector(".notifications-modal-close");
    const overlay = document.querySelector(".notifications-modal-overlay");
    const notifList = document.getElementById("notifications-list");
    const notifCounter = document.getElementById("notif-counter");

    let lastNotificationId = 0;

    // --- 1. Анімація відкриття/закриття ---

    function openNotifications() {
        if (!notifModal) return;
        // Важливо: спочатку прибираємо hidden, якщо він є в HTML
        notifModal.classList.remove("hidden");
        // Даємо браузеру мікро-паузу, щоб він зрозумів, що display змінився, і потім запускаємо анімацію
        setTimeout(() => {
            notifModal.classList.add("active");
        }, 10);

        fetchNotifications(false);
    }

    function closeNotifications() {
        if (!notifModal) return;
        notifModal.classList.remove("active");
        // Чекаємо завершення анімації (0.3s) перед тим як ховати (якщо потрібно)
        // Але оскільки ми використовуємо visibility, це необов'язково, але для надійності:
        setTimeout(() => {
             // Можна додати notifModal.classList.add("hidden") якщо потрібно
        }, 300);
    }

    if (notifBtn) notifBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openNotifications();
    });

    if (closeBtn) closeBtn.addEventListener("click", closeNotifications);
    if (overlay) overlay.addEventListener("click", closeNotifications);


    // --- 2. Логіка сповіщень ---

    async function fetchNotifications(isAutoCheck = false) {
        try {
            const response = await fetch('/api/notifications');
            if (!response.ok) return;
            const notifications = await response.json();

            updateCounter(notifications);

            // Якщо це перше завантаження сторінки - просто запам'ятовуємо останній ID
            if (lastNotificationId === 0 && notifications.length > 0) {
                lastNotificationId = notifications[0].id;
            }
            // Якщо це авто-перевірка (polling)
            else if (isAutoCheck && notifications.length > 0) {
                // Знаходимо ВСІ нові сповіщення, яких ми ще не бачили
                // (фільтруємо ті, що мають ID більше за попередній збережений)
                const newNotifs = notifications.filter(n => n.id > lastNotificationId && !n.is_read);

                // Показуємо сповіщення для КОЖНОГО нового повідомлення
                // (але не більше 3 за раз, щоб не заспамити екран)
                newNotifs.slice(0, 3).forEach(n => {
                    showBrowserNotification(n.title, n.message);
                });

                // Оновлюємо ID на найновіший
                if (newNotifs.length > 0) {
                    lastNotificationId = notifications[0].id;
                }
            }

            // Рендеримо список, тільки якщо меню відкрите
            // (або якщо ми клікнули вручну !isAutoCheck)
            if (!isAutoCheck || notifModal.classList.contains("active")) {
                renderNotifications(notifications);
            }
        } catch (error) {
            console.error("Помилка завантаження сповіщень:", error);
        }
    }

    function updateCounter(notifications) {
        const unreadCount = notifications.filter(n => !n.is_read).length;
        if (unreadCount > 0 && notifCounter) {
            notifCounter.style.display = "flex";
            notifCounter.textContent = unreadCount > 99 ? "99+" : unreadCount;
        } else if (notifCounter) {
            notifCounter.style.display = "none";
        }
    }

    function showBrowserNotification(title, body) {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body: body });
        } else if ("Notification" in window && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }

    function renderNotifications(notifications) {
        if (notifications.length === 0) {
            notifList.innerHTML = `<div class="notifications-empty">Немає нових сповіщень</div>`;
            return;
        }

        notifList.innerHTML = notifications.map(n => {
            // Форматування часу
            const timeStr = new Date(n.created_at + "Z").toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            // --- ЛОГІКА ДЛЯ ЗАПРОШЕНЬ ---
            let specialActions = '';

            // Якщо це запрошення і воно ще не прочитане (не оброблене)
            if (n.type === 'team_invite' && !n.is_read) {
                specialActions = `
                    <div class="invite-actions">
                        <button class="notif-btn accept-btn" onclick="window.acceptInvite(${n.id}, event)">
                            <i data-lucide="check-circle" width="14" height="14"></i> Прийняти
                        </button>
                        <button class="notif-btn decline-btn" onclick="window.declineInvite(${n.id}, event)">
                            <i data-lucide="x-circle" width="14" height="14"></i> Відхилити
                        </button>
                    </div>
                `;
            }

            return `
            <div class="notification-item ${n.is_read ? 'read' : 'unread'}" id="notif-${n.id}">
                <div class="notif-header">
                    <div class="notification-title">${n.title}</div>
                    <div class="notification-time">${timeStr}</div>
                </div>
                <div class="notification-message">${n.message}</div>

                ${specialActions}

                <div class="notif-actions">
                    ${!n.is_read && n.type !== 'team_invite' ? `
                    <button class="notif-btn read-btn" onclick="window.markAsRead(${n.id}, event, this)" title="Позначити прочитаним">
                        <i data-lucide="check" width="14" height="14"></i>
                    </button>` : ''}

                    <button class="notif-btn delete-btn" onclick="window.deleteNotification(${n.id}, event)" title="Видалити">
                        <i data-lucide="trash-2" width="14" height="14"></i>
                    </button>
                </div>
            </div>
            `;
        }).join('');

        lucide.createIcons();
    }

    // --- НОВІ ФУНКЦІЇ ДЛЯ ЗАПРОШЕНЬ (Додай це до window об'єкта) ---

    window.acceptInvite = async (id, event) => {
        if(event) event.stopPropagation();

        try {
            const res = await fetch(`/api/notification/${id}/team-invite/accept`, { method: 'POST' });
            if (res.ok) {
                // Успішно прийнято -> перезавантажуємо сторінку, щоб побачити нову команду
                window.location.reload();
            } else {
                const data = await res.json();
                alert(data.error || "Помилка приєднання");
            }
        } catch (e) {
            console.error(e);
            alert("Помилка з'єднання");
        }
    };

    window.declineInvite = async (id, event) => {
        if(event) event.stopPropagation();

        if(!confirm("Відхилити запрошення?")) return;

        // Відхилення працює як видалення сповіщення
        window.deleteNotification(id, null);
    };

    // --- 3. Глобальні функції дій (Read / Delete) ---
    // Додаємо їх в window, щоб HTML onclick їх бачив

    window.markAsRead = async (id, event, btnElement) => {
        if(event) event.stopPropagation(); // Зупиняємо клік, щоб не закрити меню випадково

        // 1. Миттєво змінюємо вигляд (Optimistic UI)
        const item = document.getElementById(`notif-${id}`);
        if (item) {
            item.classList.remove('unread');
            item.classList.add('read');
            // Прибираємо кнопку "Прочитати"
            if (btnElement) btnElement.style.display = 'none';
        }

        // 2. Відправляємо запит
        try {
            await fetch(`/api/notification/${id}/read`, { method: 'POST' });
            // Оновлюємо лічильник
            fetchNotifications(false);
        } catch (e) {
            console.error(e);
            // Якщо помилка - можна повернути стиль назад (опціонально)
        }
    };

    window.deleteNotification = async (id, event) => {
        if(event) event.stopPropagation();

        if(!confirm("Видалити це сповіщення?")) return;

        const item = document.getElementById(`notif-${id}`);

        // 1. Анімація зникнення
        if (item) {
            item.style.opacity = '0';
            item.style.transform = 'translateX(20px)';
        }

        try {
            const res = await fetch(`/api/notification/${id}/delete`, { method: 'DELETE' });
            if (res.ok) {
                // Видаляємо з DOM після анімації
                setTimeout(() => {
                    if(item) item.remove();
                    // Якщо список пустий
                    if(notifList.children.length === 0) {
                        notifList.innerHTML = `<div class="notifications-empty">Немає нових сповіщень</div>`;
                    }
                }, 300);
                fetchNotifications(false);
            } else {
                alert("Помилка видалення");
                if(item) item.style.opacity = '1'; // Повертаємо, якщо помилка
            }
        } catch (e) {
            console.error(e);
        }
    };

    // --- 4. Запит на дозволи та таймер ---
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // ВИКЛИКАЄМО ВІДРАЗУ при завантаженні сторінки, щоб з'явилася цифра
    fetchNotifications(false);

    // Встановлюємо інтервал перевірки (наприклад, кожні 10 секунд)
    setInterval(() => {
        fetchNotifications(true);
    }, 10000);

    // Пошук
    const searchBtn = document.getElementById("search-user-btn");
    if (searchBtn) {
        searchBtn.addEventListener("click", () => {
            const url = searchBtn.getAttribute("data-url");
            if (url) window.location.href = url;
        });
    }
});

// === Універсальний конвертер часу ===
    function convertToLocalTime() {
        const timeElements = document.querySelectorAll('.local-time');

        timeElements.forEach(el => {
            const rawDate = el.getAttribute('data-utc');
            if (!rawDate) return;

            // Додаємо "Z" в кінець, щоб браузер зрозумів, що це UTC час (час сервера)
            // Якщо у дати вже є Z або зміщення, це не зашкодить (Date розбереться),
            // але для рядків типу "2025-12-11 15:00:00" це критично.
            const dateObj = new Date(rawDate.replace(" ", "T") + "Z");

            // Форматуємо під український стандарт
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');

            // Записуємо гарний текст всередину елемента
            el.textContent = `${day}.${month}.${year} о ${hours}:${minutes}`;

            // Показуємо елемент (щоб уникнути моргання старого часу)
            el.style.opacity = '1';
        });
    }

    // Запускаємо конвертацію
    convertToLocalTime();