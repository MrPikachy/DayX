let notificationsUpdateInterval

// Load notifications on page load
if (document.querySelector(".nav-notifications-btn")) {
  loadNotifications()
  notificationsUpdateInterval = setInterval(loadNotifications, 3000)
}

document.getElementById("notifications-btn")?.addEventListener("click", toggleNotificationsModal)
document.querySelector(".notifications-modal-overlay")?.addEventListener("click", closeNotificationsModal)
document.querySelector(".notifications-modal-close")?.addEventListener("click", closeNotificationsModal)

async function loadNotifications() {
  try {
    const response = await fetch("/api/notifications")
    const notifications = await response.json()

    // Update counter
    const unreadCount = notifications.filter((n) => !n.is_read).length
    const counter = document.getElementById("notif-counter")
    if (unreadCount > 0) {
      counter.textContent = unreadCount
      counter.style.display = "flex"
    } else {
      counter.style.display = "none"
    }

    // Update list
    const list = document.getElementById("notifications-list")
    if (notifications.length === 0) {
      list.innerHTML = '<div class="notifications-empty">Немає повідомлень</div>'
    } else {
      list.innerHTML = notifications.map((notif) => createNotificationItem(notif)).join("")

      // Attach event listeners
      document.querySelectorAll(".notification-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          if (!e.target.closest("button")) {
            const notif = JSON.parse(item.dataset.notification)
            markNotificationRead(notif.id)
          }
        })
      })

      document.querySelectorAll(".notification-mark-read").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation()
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
  } catch (error) {
    console.error("Error loading notifications:", error)
  }
}

function createNotificationItem(notif) {
  const time = new Date(notif.created_at).toLocaleString("uk-UA", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

  let actions = ""
  if (notif.type === "team_invite" && !notif.is_read) {
    actions = `
      <button class="notification-action-btn primary notification-accept" data-notif-id="${notif.id}">Прийняти</button>
      <button class="notification-action-btn notification-decline" data-notif-id="${notif.id}">Відхилити</button>
    `
  }

  const notifClass = notif.type === "team_message" ? "notification-item-link" : ""
  let onClick = ""
  if (notif.type === "team_message") {
    onClick = `onclick="window.location.href='/team/${notif.related_id}'"`
  }

  return `
    <div class="notification-item ${notif.is_read ? "read" : "unread"} ${notifClass}" data-notification='${JSON.stringify(notif)}' ${onClick} style="cursor: ${notif.type === "team_message" ? "pointer" : "default"}">
      <div class="notification-title">${notif.title}</div>
      <div class="notification-message">${notif.message}</div>
      <div class="notification-time">${time}</div>
      ${actions ? `<div class="notification-actions">${actions}</div>` : ""}
      <div class="notification-icons">
        <button class="notification-icon-btn notification-mark-read" data-notif-id="${notif.id}" title="Прочитано">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6l9 6 9-6M3 12l9 6 9-6"/>
          </svg>
        </button>
        <button class="notification-icon-btn notification-delete" data-notif-id="${notif.id}" title="Видалити">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `
}

function toggleNotificationsModal() {
  document.getElementById("notifications-modal").classList.toggle("hidden")
}

function closeNotificationsModal() {
  document.getElementById("notifications-modal").classList.add("hidden")
}

async function markNotificationRead(notifId) {
  try {
    await fetch(`/api/notification/${notifId}/read`, { method: "POST" })
    loadNotifications()
  } catch (error) {
    console.error("Error:", error)
  }
}

async function deleteNotification(notifId) {
  try {
    await fetch(`/api/notification/${notifId}/delete`, { method: "DELETE" })
    loadNotifications()
  } catch (error) {
    console.error("Error:", error)
  }
}

async function acceptTeamInvite(notifId) {
  try {
    const response = await fetch(`/api/notification/${notifId}/team-invite/accept`, { method: "POST" })
    if (response.ok) {
      alert("Ви приєдналися до команди!")
      loadNotifications()
    }
  } catch (error) {
    console.error("Error:", error)
  }
}

async function declineTeamInvite(notifId) {
  try {
    await fetch(`/api/notification/${notifId}/delete`, { method: "DELETE" })
    loadNotifications()
  } catch (error) {
    console.error("Error:", error)
  }
}

// ===== Team Chat Functions =====

const teamId = window.location.pathname.split("/")[2]
const isCreator = window.location.pathname.includes("/team/") && document.getElementById("rename-btn") !== null

// Send message
document.getElementById("send-btn")?.addEventListener("click", sendMessage)
document.getElementById("message-input")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage()
})

async function sendMessage() {
  const input = document.getElementById("message-input")
  if (!input) return

  const message = input.value.trim()
  if (!message) return

  try {
    const response = await fetch(`/api/team/${teamId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })

    if (response.ok) {
      input.value = ""
      location.reload()
    }
  } catch (error) {
    console.error("Error:", error)
  }
}

// Members button
document.getElementById("members-btn")?.addEventListener("click", () => {
  document.getElementById("modal-members").classList.remove("hidden")
})

document.getElementById("close-members")?.addEventListener("click", () => {
  document.getElementById("modal-members").classList.add("hidden")
})

// Remove member buttons
document.querySelectorAll(".btn-remove-member").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const memberId = btn.dataset.memberId
    if (!confirm("Ви впевнені?")) return

    try {
      const response = await fetch(`/api/team/${teamId}/remove-member/${memberId}`, {
        method: "DELETE",
      })
      if (response.ok) location.reload()
    } catch (error) {
      console.error("Error:", error)
    }
  })
})

// Rename button
if (document.getElementById("rename-btn")) {
  document.getElementById("rename-btn").addEventListener("click", () => {
    document.getElementById("modal-rename").classList.remove("hidden")
  })

  document.getElementById("save-rename")?.addEventListener("click", async () => {
    const newName = document.getElementById("new-team-name").value.trim()
    if (!newName) return

    try {
      const response = await fetch(`/api/team/${teamId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      })
      if (response.ok) location.reload()
    } catch (error) {
      console.error("Error:", error)
    }
  })

  // Add member button
  document.getElementById("add-member-btn").addEventListener("click", () => {
    document.getElementById("modal-add-member").classList.remove("hidden")
    document.getElementById("add-member-email").focus()
  })

  document.getElementById("confirm-add-member")?.addEventListener("click", async () => {
    const email = document.getElementById("add-member-email").value.trim()
    const errorDiv = document.getElementById("add-member-error")

    if (!email) {
      errorDiv.textContent = "Введіть email"
      errorDiv.style.display = "block"
      return
    }

    try {
      const response = await fetch(`/api/team/${teamId}/add-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (response.ok) {
        location.reload()
      } else {
        const data = await response.json()
        errorDiv.textContent = data.error || "Помилка"
        errorDiv.style.display = "block"
      }
    } catch (error) {
      errorDiv.textContent = "Помилка"
      errorDiv.style.display = "block"
    }
  })

  // Disband button
  document.getElementById("disband-btn")?.addEventListener("click", async () => {
    if (!confirm("Ви впевнені? Це видалить команду назавжди.")) return

    try {
      const response = await fetch(`/api/team/${teamId}/disband`, {
        method: "POST",
      })
      if (response.ok) {
        window.location.href = "/teams"
      }
    } catch (error) {
      console.error("Error:", error)
    }
  })
}

// Leave button
document.getElementById("leave-btn")?.addEventListener("click", async () => {
  if (!confirm("Ви впевнені?")) return

  try {
    const response = await fetch(`/api/team/${teamId}/leave`, {
      method: "POST",
    })
    if (response.ok) {
      window.location.href = "/teams"
    }
  } catch (error) {
    console.error("Error:", error)
  }
})

// Modal overlays
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    e.currentTarget.parentElement.classList.add("hidden")
  })
})

document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.closest(".modal").classList.add("hidden")
  })
})

document.getElementById("cancel-rename")?.addEventListener("click", () => {
  document.getElementById("modal-rename").classList.add("hidden")
})

document.getElementById("cancel-add-member")?.addEventListener("click", () => {
  document.getElementById("modal-add-member").classList.add("hidden")
})

// ===== Teams Page Functions =====

document.getElementById("create-team-btn")?.addEventListener("click", () => {
  document.getElementById("modal-create-team").classList.remove("hidden")
  document.getElementById("team-name-input").focus()
})

document.getElementById("cancel-team")?.addEventListener("click", () => {
  document.getElementById("modal-create-team").classList.add("hidden")
})

document.querySelector("#modal-create-team .modal-overlay")?.addEventListener("click", () => {
  document.getElementById("modal-create-team").classList.add("hidden")
})

document.querySelector("#modal-create-team .modal-close")?.addEventListener("click", () => {
  document.getElementById("modal-create-team").classList.add("hidden")
})

document.getElementById("create-team-confirm")?.addEventListener("click", async () => {
  const name = document.getElementById("team-name-input").value.trim()

  if (!name) {
    alert("Введіть назву команди")
    return
  }

  try {
    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })

    if (response.ok) {
      window.location.reload()
    } else {
      alert("Помилка при створенні команди")
    }
  } catch (error) {
    console.error("Error:", error)
    alert("Помилка")
  }
})
