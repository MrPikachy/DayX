let currentTaskId = null
let currentTeamId = null
let currentListType = "personal"
let personalTasks = []
const teamTasks = {}
const user_teams = {}
let selectedMembers = []
let allTeamMembers = []

// Initialize tasks system
document.addEventListener("DOMContentLoaded", () => {
  const savedTab = localStorage.getItem("selectedTaskTab")
  setupEventListeners()

  if (savedTab && savedTab.startsWith("team-")) {
    const teamId = Number.parseInt(savedTab.split("-")[1])
    const tabBtn = document.querySelector(`[data-tab="${savedTab}"]`)
    if (tabBtn) {
      tabBtn.click()
    } else {
      loadPersonalTasks()
    }
  } else {
    loadPersonalTasks()
  }
})

function setupEventListeners() {
  document.getElementById("btn-create-task").addEventListener("click", openCreateTaskModal)
  document.getElementById("btn-close-modal").addEventListener("click", closeTaskModal)
  document.querySelector(".modal-close").addEventListener("click", closeTaskModal)
  document.getElementById("task-modal").addEventListener("click", handleModalOverlayClick)
  document.getElementById("task-form").addEventListener("submit", saveTask)

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", switchTab)
  })

  document.addEventListener("contextmenu", handleRightClick)
  document.addEventListener("click", closeContextMenu)

  const memberCloseBtn = document.querySelector("#member-modal .modal-close")
  if (memberCloseBtn) {
    memberCloseBtn.addEventListener("click", closeMemberModal)
  }
  document.getElementById("member-modal").addEventListener("click", handleMemberModalOverlayClick)
  document.getElementById("btn-select-members").addEventListener("click", openMemberSelection)
  document.getElementById("btn-close-member-modal").addEventListener("click", closeMemberModal)
}

function handleRightClick(e) {
  // Handle right-click event here
}

function loadPersonalTasks() {
  fetch("/api/tasks/personal")
    .then((r) => r.json())
    .then((data) => {
      personalTasks = data
      renderPersonalTasks()
    })
}

function renderPersonalTasks() {
  const active = document.getElementById("active-personal")
  const completed = document.getElementById("completed-personal")

  active.innerHTML = ""
  completed.innerHTML = ""

  loadTeamMembers(null)

  personalTasks.forEach((task) => {
    const card = createTaskCard(task, null)
    if (task.is_completed) {
      completed.appendChild(card)
    } else {
      active.appendChild(card)
    }
  })
}

function createTaskCard(task, teamId) {
  const card = document.createElement("div")
  card.className = `task-card ${task.is_completed ? "completed" : ""}`
  card.dataset.taskId = task.id
  card.dataset.teamId = teamId || ""

  const checkbox = document.createElement("input")
  checkbox.type = "checkbox"
  checkbox.className = "task-checkbox"
  checkbox.checked = task.is_completed
  checkbox.addEventListener("change", (e) => {
    e.stopPropagation()
    toggleTaskComplete(task.id, e.target.checked, teamId)
  })

  const title = document.createElement("div")
  title.className = "task-title"
  title.textContent = task.title

  const description = document.createElement("div")
  description.className = "task-description"
  description.textContent = task.description || ""

  const deadline = document.createElement("div")
  deadline.className = "task-deadline"
  if (task.deadline) {
    const deadlineDate = new Date(task.deadline)
    const now = new Date()
    const daysUntil = Math.ceil((deadlineDate - now) / (1000 * 60 * 60 * 24))

    deadline.textContent = deadlineDate.toLocaleString("uk-UA", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })

    if (daysUntil < 1) {
      deadline.classList.add("urgent")
    }
  }

  const assignedMembers = document.createElement("div")
  assignedMembers.className = "task-assigned-members"
  assignedMembers.style.cssText = "margin-top: 8px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;"

  if (task.assigned_to_ids) {
    try {
      const memberIds =
        typeof task.assigned_to_ids === "string" ? JSON.parse(task.assigned_to_ids) : task.assigned_to_ids

      if (Array.isArray(memberIds) && memberIds.length > 0) {
        const displayMembers = memberIds.slice(0, 4)
        displayMembers.forEach((memberId) => {
          const member = allTeamMembers.find((m) => m.id === memberId)
          const memberName = member ? `${member.first_name} ${member.last_name}` : `Користувач ${memberId}`

          const badge = document.createElement("span")
          badge.style.cssText =
            "background: #e3f2fd; color: #1976d2; padding: 4px 8px; border-radius: 3px; font-size: 11px; display: inline-block; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          badge.title = memberName
          badge.textContent = memberName
          assignedMembers.appendChild(badge)
        })

        if (memberIds.length > 4) {
          const moreBadge = document.createElement("span")
          moreBadge.style.cssText =
            "background: #f0f0f0; color: #666; padding: 4px 8px; border-radius: 3px; font-size: 11px; display: inline-block;"
          moreBadge.textContent = `+${memberIds.length - 4}`
          assignedMembers.appendChild(moreBadge)
        }
      }
    } catch (e) {
      console.error("[v0] Error parsing assigned_to_ids:", e)
    }
  }

  card.appendChild(checkbox)
  card.appendChild(title)
  if (description.textContent) card.appendChild(description)
  if (deadline.textContent) card.appendChild(deadline)
  if (assignedMembers.children.length > 0) card.appendChild(assignedMembers)

  card.addEventListener("contextmenu", (e) => openTaskContextMenu(e, task, teamId))

  return card
}

function openCreateTaskModal() {
  currentTaskId = null
  document.getElementById("modal-title").textContent = "Створити задачу"
  document.getElementById("task-title").value = ""
  document.getElementById("task-description").value = ""
  document.getElementById("task-deadline").value = ""

  selectedMembers = []
  document.getElementById("selected-members").innerHTML = ""

  const assignToGroup = document.getElementById("assign-to-group")
  if (currentListType === "personal") {
    assignToGroup.style.display = "none"
  } else {
    assignToGroup.style.display = "block"
    loadTeamMembers(currentTeamId)
  }

  document.getElementById("task-modal").classList.remove("hidden")
}

function closeTaskModal() {
  document.getElementById("task-modal").classList.add("hidden")
}

function handleModalOverlayClick(e) {
  if (e.target === document.getElementById("task-modal")) {
    closeTaskModal()
  }
}

function openMemberSelection() {
  if (allTeamMembers.length === 0) {
    console.log("[v0] No team members loaded, trying to reload")
    loadTeamMembers(currentTeamId)

    // Wait a bit for members to load
    setTimeout(() => {
      renderMembersList()
      document.getElementById("member-modal").classList.remove("hidden")
    }, 500)
  } else {
    renderMembersList()
    document.getElementById("member-modal").classList.remove("hidden")
  }
}

function renderMembersList() {
  const membersList = document.getElementById("members-list")
  membersList.innerHTML = ""

  allTeamMembers.forEach((member) => {
    const isSelected = selectedMembers.some((m) => m.id === member.id)
    const memberItem = document.createElement("div")
    memberItem.className = "member-item"
    memberItem.style.cssText =
      "display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;"

    // Створюємо контейнер для аватара та імені
    const infoContainer = document.createElement("div")
    infoContainer.style.cssText = "display: flex; align-items: center; gap: 10px;"

    // --- ЛОГІКА АВАТАРКИ ---
    let avatarEl
    if (member.avatar) {
      avatarEl = document.createElement("img")
      avatarEl.src = member.avatar
      avatarEl.style.cssText = "width: 32px; height: 32px; border-radius: 50%; object-fit: cover;"
    } else {
      avatarEl = document.createElement("div")
      avatarEl.style.cssText =
        "width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #1f71e8, #5294e2); color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;"
      // Беремо перші літери імені та прізвища
      const initials = (member.first_name[0] || "") + (member.last_name[0] || "")
      avatarEl.textContent = initials
    }
    // -----------------------

    const nameSpan = document.createElement("span")
    nameSpan.textContent = `${member.first_name} ${member.last_name}`

    infoContainer.appendChild(avatarEl)
    infoContainer.appendChild(nameSpan)

    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = `btn ${isSelected ? "btn-danger" : "btn-primary"}`
    btn.style.cssText = "padding: 5px 10px; font-size: 12px;"
    btn.textContent = isSelected ? "Видалити" : "Додати"
    btn.dataset.memberId = member.id
    btn.addEventListener("click", (e) => {
      e.preventDefault()
      toggleMemberSelection(member)
    })

    memberItem.appendChild(infoContainer)
    memberItem.appendChild(btn)
    membersList.appendChild(memberItem)
  })
}

function closeMemberModal() {
  document.getElementById("member-modal").classList.add("hidden")
  renderSelectedMembers()
}

function handleMemberModalOverlayClick(e) {
  if (e.target === document.getElementById("member-modal")) {
    closeMemberModal()
  }
}

function toggleMemberSelection(member) {
  const index = selectedMembers.findIndex((m) => m.id === member.id)
  if (index > -1) {
    selectedMembers.splice(index, 1)
  } else {
    selectedMembers.push(member)
  }
  openMemberSelection()
}

function renderSelectedMembers() {
  const container = document.getElementById("selected-members")
  container.innerHTML = ""

  if (selectedMembers.length === 0) return

  selectedMembers.forEach((member) => {
    const tag = document.createElement("div")
    tag.className = "member-tag"
    tag.style.cssText =
      "display: inline-block; background: #007bff; color: white; padding: 5px 10px; margin: 3px; border-radius: 4px; font-size: 12px;"

    const name = document.createElement("span")
    name.textContent = `${member.first_name} ${member.last_name}`

    const closeBtn = document.createElement("button")
    closeBtn.type = "button"
    closeBtn.textContent = " ✕"
    closeBtn.style.cssText = "background: none; border: none; color: white; cursor: pointer; padding: 0 5px;"
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault()
      selectedMembers = selectedMembers.filter((m) => m.id !== member.id)
      renderSelectedMembers()
    })

    tag.appendChild(name)
    tag.appendChild(closeBtn)
    container.appendChild(tag)
  })
}

function loadTeamMembers(teamId) {
  console.log("[v0] Loading team members for team:", teamId)
  fetch(`/api/team/${teamId}/members`)
    .then((r) => {
      console.log("[v0] Team members response status:", r.status)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .then((data) => {
      console.log("[v0] Team members loaded:", data)
      allTeamMembers = Array.isArray(data) ? data : Object.values(data)
      console.log("[v0] All team members after processing:", allTeamMembers)
    })
    .catch((err) => {
      console.error("[v0] Error loading team members:", err)
      allTeamMembers = []
    })
}

function saveTask(e) {
  e.preventDefault()

  const title = document.getElementById("task-title").value.trim()
  const description = document.getElementById("task-description").value.trim()
  const deadline = document.getElementById("task-deadline").value

  const teamId = currentListType === "team" ? currentTeamId : null

  const assignedToIds = selectedMembers.map((m) => m.id)

  if (!title) {
    alert("Введіть назву задачи")
    return
  }

  const payload = {
    title,
    description,
    deadline: deadline || null,
    team_id: teamId ? Number.parseInt(teamId) : null,
    assigned_to_ids: assignedToIds.length > 0 ? assignedToIds : [],
  }

  const url = currentTaskId ? `/api/tasks/${currentTaskId}` : "/api/tasks"
  const method = currentTaskId ? "PUT" : "POST"

  fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        if (currentListType === "personal") {
          loadPersonalTasks()
        } else {
          loadTeamTasks(currentTeamId)
        }
        closeTaskModal()
      } else {
        console.error("[v0] Error saving task:", data)
        alert("Помилка при збереженні задачи")
      }
    })
    .catch((err) => {
      console.error("[v0] Error during task save:", err)
      alert("Помилка при збереженні задачи")
    })
}

function toggleTaskComplete(taskId, completed, teamId) {
  fetch(`/api/tasks/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_completed: completed ? 1 : 0 }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        if (teamId) {
          loadTeamTasks(teamId)
        } else {
          loadPersonalTasks()
        }
      }
    })
}

function openTaskContextMenu(e, task, teamId) {
  e.preventDefault()
  currentTaskId = task.id
  currentTeamId = teamId

  const menu = document.getElementById("task-context-menu")
  menu.style.left = e.pageX + "px"
  menu.style.top = e.pageY + "px"
  menu.classList.remove("hidden")
}

function closeContextMenu() {
  document.getElementById("task-context-menu").classList.add("hidden")
}

function switchTab(e) {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"))
  document.querySelectorAll(".tab-content").forEach((tab) => tab.classList.remove("active"))

  e.target.classList.add("active")
  const tabId = e.target.dataset.tab
  document.getElementById(tabId).classList.add("active")

  localStorage.setItem("selectedTaskTab", tabId)

  if (tabId.startsWith("team-")) {
    currentListType = "team"
    currentTeamId = Number.parseInt(tabId.split("-")[1])
    loadTeamTasks(currentTeamId)
  } else {
    currentListType = "personal"
    currentTeamId = null
  }
}

function loadTeamTasks(teamId) {
  fetch(`/api/tasks/team/${teamId}`)
    .then((r) => r.json())
    .then((data) => {
      teamTasks[teamId] = data
      renderTeamTasks(teamId)
    })
}

function renderTeamTasks(teamId) {
  const active = document.getElementById(`active-team-${teamId}`)
  const completed = document.getElementById(`completed-team-${teamId}`)

  if (!active || !completed) return

  active.innerHTML = ""
  completed.innerHTML = ""

  loadTeamMembers(teamId)

  // Wait for members to load, then render tasks
  setTimeout(() => {
    ;(teamTasks[teamId] || []).forEach((task) => {
      const card = createTaskCard(task, teamId)
      if (task.is_completed) {
        completed.appendChild(card)
      } else {
        active.appendChild(card)
      }
    })
  }, 300)
}

// Context menu actions
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("context-menu-item")) {
    const action = e.target.dataset.action

    if (action === "toggle-complete") {
      const card = document.querySelector(`[data-task-id="${currentTaskId}"]`)
      const isCompleted = card.classList.contains("completed")
      toggleTaskComplete(currentTaskId, !isCompleted, currentTeamId)
    } else if (action === "edit") {
      openEditTaskModal(currentTaskId, currentTeamId)
    } else if (action === "delete") {
      if (confirm("Ви дійсно хочете видалити це завдання?")) {
        fetch(`/api/tasks/${currentTaskId}`, { method: "DELETE" })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) {
              if (currentTeamId) {
                loadTeamTasks(currentTeamId)
              } else {
                loadPersonalTasks()
              }
            }
          })
      }
    }
    closeContextMenu()
  }
})

function openEditTaskModal(taskId, teamId) {
  // Find the task
  let task = null
  if (teamId) {
    task = (teamTasks[teamId] || []).find((t) => t.id === taskId)
  } else {
    task = personalTasks.find((t) => t.id === taskId)
  }

  if (!task) return

  currentTaskId = taskId
  currentTeamId = teamId
  document.getElementById("modal-title").textContent = "Редагувати задачу"
  document.getElementById("task-title").value = task.title
  document.getElementById("task-description").value = task.description || ""

  if (task.deadline) {
    const date = new Date(task.deadline)
    document.getElementById("task-deadline").value = date.toISOString().slice(0, 16)
  } else {
    document.getElementById("task-deadline").value = ""
  }

  selectedMembers = []
  if (task.assigned_to_ids) {
    try {
      const memberIds =
        typeof task.assigned_to_ids === "string" ? JSON.parse(task.assigned_to_ids) : task.assigned_to_ids

      if (Array.isArray(memberIds)) {
        // Load team members first, then find selected ones
        loadTeamMembers(teamId)
        setTimeout(() => {
          memberIds.forEach((memberId) => {
            const member = allTeamMembers.find((m) => m.id === memberId)
            if (member && !selectedMembers.find((m) => m.id === member.id)) {
              selectedMembers.push(member)
            }
          })
          renderSelectedMembers()
        }, 600)
      }
    } catch (e) {
      console.error("[v0] Error parsing assigned members:", e)
    }
  }

  const assignToGroup = document.getElementById("assign-to-group")
  if (teamId) {
    assignToGroup.style.display = "block"
    loadTeamMembers(teamId)
  } else {
    assignToGroup.style.display = "none"
  }

  document.getElementById("task-modal").classList.remove("hidden")
}
