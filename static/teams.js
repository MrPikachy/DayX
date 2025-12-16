let notificationsUpdateInterval

// 1. Запитуємо дозвіл на браузерні сповіщення при старті
document.addEventListener("DOMContentLoaded", () => {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // Запускаємо оновлення, якщо є кнопка дзвіночка
    if (document.querySelector(".nav-notifications-btn")) {
      loadNotifications()
      notificationsUpdateInterval = setInterval(loadNotifications, 3000)
    }
});

document.getElementById("notifications-btn")?.addEventListener("click", toggleNotificationsModal)
document.querySelector(".notifications-modal-overlay")?.addEventListener("click", closeNotificationsModal)
document.querySelector(".notifications-modal-close")?.addEventListener("click", closeNotificationsModal)

// --- ГОЛОВНА ФУНКЦІЯ ---
async function loadNotifications() {
  try {
    const response = await fetch("/api/notifications")
    const notifications = await response.json()

    // 1. ЛОГІКА БРАУЗЕРНИХ СПОВІЩЕНЬ (Desktop Notifications)
    // Фільтруємо лише непрочитані
    const unreadNotifications = notifications.filter((n) => !n.is_read);

    // Отримуємо ID останнього сповіщення, про яке ми вже повідомляли
    const lastNotifId = localStorage.getItem('lastNotificationId');

    if (unreadNotifications.length > 0) {
        // Оскільки сортування DESC, найновіше - перше (індекс 0)
        const newest = unreadNotifications[0];

        // Якщо це сповіщення новіше за те, що ми бачили востаннє
        if (!lastNotifId || newest.id > parseInt(lastNotifId)) {
            // Перевіряємо дозвіл браузера
            if ("Notification" in window && Notification.permission === "granted") {
                // Створюємо спливаюче вікно
                new Notification(`Day X: ${newest.title}`, {
                    body: newest.message,
                    icon: "/static/icon.png", // Переконайтесь, що icon.png існує
                    tag: "dayx-notification" // Щоб не нашаровувати багато вікон
                });
            }
            // Запам'ятовуємо ID, щоб не показувати це саме сповіщення знову
            localStorage.setItem('lastNotificationId', newest.id);
        }
    }

    // 2. ОНОВЛЕННЯ ІНТЕРФЕЙСУ (Червоний лічильник)
    const unreadCount = unreadNotifications.length
    const counter = document.getElementById("notif-counter")
    if (counter) {
        if (unreadCount > 0) {
          counter.textContent = unreadCount
          counter.style.display = "flex"
        } else {
          counter.style.display = "none"
        }
    }

    // 3. ОНОВЛЕННЯ СПИСКУ В МОДАЛЦІ
    const list = document.getElementById("notifications-list")
    if (list) {
        if (notifications.length === 0) {
          list.innerHTML = '<div class="notifications-empty">Немає повідомлень</div>'
        } else {
          list.innerHTML = notifications.map((notif) => createNotificationItem(notif)).join("")

          // 4. ПРИВ'ЯЗКА ПОДІЙ ДО КНОПОК (адже ми перемалювали HTML)
          attachNotificationListeners();
        }
    }
  } catch (error) {
    console.error("Error loading notifications:", error)
  }
}

// Функція генерації HTML для одного сповіщення
function createNotificationItem(notif) {
  const time = new Date(notif.created_at).toLocaleString("uk-UA", {
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })

  // Кнопки для запрошень
  let actions = ""
  if (notif.type === "team_invite" && !notif.is_read) {
    actions = `
      <div class="notification-actions">
          <button class="notification-action-btn primary notification-accept" data-notif-id="${notif.id}">Прийняти</button>
          <button class="notification-action-btn notification-decline" data-notif-id="${notif.id}">Відхилити</button>
      </div>
    `
  }

  // Якщо це повідомлення чату - робимо весь блок клікабельним
  const isLink = notif.type === "team_message";
  const onClickAttr = isLink ? `onclick="window.location.href='/team/${notif.related_id}'"` : "";
  const cursorStyle = isLink ? "pointer" : "default";

  return `
    <div class="notification-item ${notif.is_read ? "read" : "unread"}"
         data-notification='${JSON.stringify(notif)}'
         ${onClickAttr}
         style="cursor: ${cursorStyle}">

      <div class="notification-title">${notif.title}</div>
      <div class="notification-message">${notif.message}</div>
      <div class="notification-time">${time}</div>
      ${actions}

      <div class="notification-icons">
        <button class="notification-icon-btn notification-mark-read" data-notif-id="${notif.id}" title="Прочитано">
          ✓
        </button>
        <button class="notification-icon-btn notification-delete" data-notif-id="${notif.id}" title="Видалити">
          ✕
        </button>
      </div>
    </div>
  `
}

// Прив'язка слухачів подій (винесена окремо для чистоти)
function attachNotificationListeners() {
    // Клік на саме сповіщення (щоб помітити прочитаним)
    document.querySelectorAll(".notification-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          // Ігноруємо клік, якщо натиснули на кнопку всередині
          if (!e.target.closest("button")) {
            const notif = JSON.parse(item.dataset.notification)
            // Якщо це не лінк (лінки обробляються через onclick в HTML), то просто маркуємо
            if (notif.type !== "team_message") {
                markNotificationRead(notif.id)
            }
          }
        })
    })

    document.querySelectorAll(".notification-mark-read").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation() // Щоб не спрацював клік на батьківський елемент
          markNotificationRead(btn.dataset.notifId)
        })
    })

    document.querySelectorAll(".notification-delete").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation()
          deleteNotification(btn.dataset.notifId)
        })
    })

    document.querySelectorAll(".notification-accept").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation()
          acceptTeamInvite(btn.dataset.notifId)
        })
    })

    document.querySelectorAll(".notification-decline").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation()
          declineTeamInvite(btn.dataset.notifId)
        })
    })
}

// --- ДОДАТКОВІ ФУНКЦІЇ ---

function toggleNotificationsModal() {
  document.getElementById("notifications-modal").classList.toggle("hidden")
}

function closeNotificationsModal() {
  document.getElementById("notifications-modal").classList.add("hidden")
}

async function markNotificationRead(notifId) {
  try {
    await fetch(`/api/notification/${notifId}/read`, { method: "POST" })
    loadNotifications() // Оновлюємо список
  } catch (error) { console.error("Error:", error) }
}

async function deleteNotification(notifId) {
  try {
    await fetch(`/api/notification/${notifId}/delete`, { method: "DELETE" })
    loadNotifications()
  } catch (error) { console.error("Error:", error) }
}

async function acceptTeamInvite(notifId) {
  try {
    const response = await fetch(`/api/notification/${notifId}/team-invite/accept`, { method: "POST" })
    if (response.ok) {
      alert("Ви приєдналися до команди!")
      loadNotifications()
      window.location.reload() // Оновлюємо сторінку, щоб побачити нову команду
    } else {
        const d = await response.json();
        alert(d.error || "Помилка");
    }
  } catch (error) { console.error("Error:", error) }
}

async function declineTeamInvite(notifId) {
  try {
    // Відхилення = просто видалення сповіщення
    await fetch(`/api/notification/${notifId}/delete`, { method: "DELETE" })
    loadNotifications()
  } catch (error) { console.error("Error:", error) }
}

// ===== Teams Page Functions (Create Team) =====
// Цей код потрібен лише для сторінки /teams
if (document.getElementById("create-team-btn")) {
    document.getElementById("create-team-btn").addEventListener("click", () => {
      document.getElementById("modal-create-team").classList.remove("hidden")
      document.getElementById("team-name-input").focus()
    })

    document.getElementById("cancel-team")?.addEventListener("click", () => {
      document.getElementById("modal-create-team").classList.add("hidden")
    })

    document.querySelector("#modal-create-team .modal-overlay")?.addEventListener("click", () => {
      document.getElementById("modal-create-team").classList.add("hidden")
    })

    document.getElementById("create-team-confirm")?.addEventListener("click", async () => {
      const name = document.getElementById("team-name-input").value.trim()
      if (!name) { alert("Введіть назву команди"); return }

      try {
        const response = await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        })
        if (response.ok) window.location.reload()
        else alert("Помилка при створенні команди")
      } catch (error) { console.error("Error:", error); alert("Помилка") }
    })
}