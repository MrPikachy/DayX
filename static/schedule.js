const LPNU_API = "https://student.lpnu.ua/students_schedule"
let currentDate = new Date()
const currentGroup = window.CURRENT_USER_GROUP
let currentSubgroup = (typeof window.CURRENT_USER_SUBGROUP !== 'undefined') ? parseInt(window.CURRENT_USER_SUBGROUP, 10) : 1;
if (!currentSubgroup || (currentSubgroup !== 1 && currentSubgroup !== 2)) currentSubgroup = 1;
let allEvents = []
let editingEventId = null
let editingEventDate = null

// Format date as YYYY-MM-DD
function formatDate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// Get first day of month (Monday = 0)
function getFirstDayOfMonth(d) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  return (first.getDay() + 6) % 7
}

// Initialize calendar
async function initCalendar() {
  if (!currentGroup) {
    console.log("No group selected")
    return
  }

  setupSubgroupSwitcher()
  updateSubgroupUI()
  await fetchSchedule()
  renderCalendar()
  setupEventListeners()
}

async function fetchSchedule() {
  try {
    const response = await fetch(`/api/schedule/${currentGroup}?subgroup=${currentSubgroup}`)
    const data = await response.json()

    // Use events from API directly (already formatted for calendar)
    allEvents = data.events || []
    console.log("[v0] Loaded", allEvents.length, "events")
  } catch (error) {
    console.error("[v0] Error fetching schedule:", error)
    allEvents = []
  }
}

function getEventsForDate(dateStr) {
  return allEvents.filter((e) => {
    const eventStart = e.start || ""
    // Extract date from ISO format (YYYY-MM-DDTHH:MM:SS)
    const eventDate = eventStart.split("T")[0]
    return eventDate === dateStr
  })
}

// Render month calendar
function renderCalendar() {
  const monthLabel = document.getElementById("month-label")
  const calendar = document.getElementById("calendar")
  calendar.innerHTML = ""

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = getFirstDayOfMonth(currentDate)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = formatDate(new Date())

  // Update month label
  const monthName = currentDate.toLocaleString("uk-UA", {
    month: "long",
    year: "numeric",
  })
  monthLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1)

  // Create empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement("div")
    emptyCell.className = "calendar-day empty"
    calendar.appendChild(emptyCell)
  }

  // Create cells for each day of month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    const dateStr = formatDate(date)
    const isToday = dateStr === today

    const dayCell = document.createElement("div")
    dayCell.className = `calendar-day ${isToday ? "today" : ""}`
    dayCell.dataset.date = dateStr

    // Day number
    const dayNum = document.createElement("div")
    dayNum.className = "day-number"
    dayNum.textContent = day
    dayCell.appendChild(dayNum)

    // Events container
    const eventsContainer = document.createElement("div")
    eventsContainer.className = "day-events"

    const dayEvents = getEventsForDate(dateStr)
    dayEvents.sort((a, b) => {
      const aS = a.start || ""
      const bS = b.start || ""
      return aS.localeCompare(bS)
    })
    dayEvents.forEach((event) => {
      const eventEl = createEventElement(event, dateStr)
      eventsContainer.appendChild(eventEl)
    })

    dayCell.appendChild(eventsContainer)

    dayCell.addEventListener("contextmenu", (e) => {
      const isEventClick = e.target.closest(".day-event")
      if (!isEventClick) {
        e.preventDefault()
        showContextMenu("empty", dateStr, null, e)
      }
    })

    calendar.appendChild(dayCell)
  }
}

// Create event element
function createEventElement(event, dateStr) {
  const el = document.createElement("div")
  const typeClass = (event.className && event.className[0]) ? event.className[0] : "event-other"
  const isCustom = event.extendedProps && event.extendedProps.raw && (parseInt(event.extendedProps.raw.is_custom || 0) === 1)

  el.className = `day-event ${typeClass} ${isCustom ? "custom" : ""}`
  el.dataset.eventId = event.id

  const title = event.title || "Подія"
  const startTime = event.start ? (event.start.split("T")[1] || "").substring(0,5) : ""
  const endTime = event.end ? (event.end.split("T")[1] || "").substring(0,5) : ""
  const timeRange = startTime ? (startTime + (endTime ? ` - ${endTime}` : "")) : ""

  let displayText = title
  if (displayText.length > 20) displayText = displayText.substring(0, 20) + "…"
  if (timeRange) displayText = `${displayText} · ${timeRange}`

  el.textContent = displayText
  el.title = `${title}\n${timeRange}`

  // Ліва кнопка: тільки для власних подій відкриває редагування
  el.addEventListener("click", (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    if (isCustom) {
      openFullModal(dateStr, event) // редагування власної події
    } else {
      // можна показати легкий tooltip або нічого — тут нічого
    }
  })

  // ПКМ (right click)
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (isCustom) {
      // контекстне меню для власної події (редагування/видалення)
      showContextMenu("event", dateStr, event, e)
    } else {
      // для пар з розкладу відкриваємо view-only інформаційне вікно
      showContextMenu("hide-all") // сховати інші меню
      openViewModal(event)
    }
  })

  return el
}



function showContextMenu(type, dateStr, event, mouseEvent) {
  const eventMenu = document.getElementById("event-context-menu")
  const emptyMenu = document.getElementById("empty-context-menu")

  // Hide both menus first
  eventMenu.classList.add("hidden")
  emptyMenu.classList.add("hidden")

  if (type === "event" && event) {
    editingEventId = event.id
    editingEventDate = dateStr
    eventMenu.style.left = mouseEvent.clientX + "px"
    eventMenu.style.top = mouseEvent.clientY + "px"
    eventMenu.classList.remove("hidden")
  } else if (type === "empty") {
    editingEventDate = dateStr
    editingEventId = null
    emptyMenu.style.left = mouseEvent.clientX + "px"
    emptyMenu.style.top = mouseEvent.clientY + "px"
    emptyMenu.classList.remove("hidden")
  }
}

document.addEventListener("click", () => {
  document.getElementById("event-context-menu").classList.add("hidden")
  document.getElementById("empty-context-menu").classList.add("hidden")
})

// Close modal
function closeModal() {
  const modal = document.getElementById("modal")
  // відновимо поля editable якщо були readonly
  const inputs = modal.querySelectorAll("input, select, textarea, button")
  inputs.forEach(i => {
    i.removeAttribute("disabled")
  })
  // відновимо save btn та cancel btn text
  const saveBtn = document.getElementById("save-ev")
  if (saveBtn) saveBtn.style.display = ""
  const cancelBtn = document.getElementById("cancel-ev")
  if (cancelBtn) cancelBtn.textContent = "Скасувати"

  modal.classList.add("hidden")
  editingEventId = null
  editingEventDate = null
  modal._v0_view_mode = false
}


// Open full event modal
function openFullModal(dateStr, eventData = null) {
  const modal = document.getElementById("modal")
  const title = document.getElementById("modal-title")
  const titleInput = document.getElementById("ev-title")
  const dateInput = document.getElementById("ev-date")
  const typeInput = document.getElementById("ev-type")
  const startInput = document.getElementById("ev-start")
  const endInput = document.getElementById("ev-end")

  if (eventData && eventData.extendedProps && eventData.extendedProps.raw && eventData.extendedProps.raw.is_custom) {
    title.textContent = "Редагувати подію"
    titleInput.value = eventData.title || ""
    dateInput.value = eventData.start ? eventData.start.split("T")[0] : dateStr
    typeInput.value = eventData.extendedProps.raw.type || "other"
    startInput.value = eventData.start ? eventData.start.substring(11, 16) : ""
    endInput.value = eventData.end ? eventData.end.substring(11, 16) : ""
    editingEventId = eventData.id
  } else {
    title.textContent = "Додати подію"
    titleInput.value = ""
    dateInput.value = dateStr
    typeInput.value = "other"
    startInput.value = ""
    endInput.value = ""
    editingEventId = null
  }

  editingEventDate = dateStr
  modal.classList.remove("hidden")
  titleInput.focus()
}

function openEditNameModal() {
  if (!editingEventId) return
  const event = allEvents.find((e) => e.id == editingEventId)
  if (!event) return

  const modal = document.getElementById("modal-edit-name")
  const input = document.getElementById("edit-name-input")
  input.value = event.title || ""
  modal.classList.remove("hidden")
  input.focus()
}

function openEditTimeModal() {
  if (!editingEventId) return
  const event = allEvents.find((e) => e.id == editingEventId)
  if (!event) return

  const modal = document.getElementById("modal-edit-time")
  const startInput = document.getElementById("edit-time-start")
  const endInput = document.getElementById("edit-time-end")
  startInput.value = event.start ? event.start.substring(11, 16) : ""
  endInput.value = event.end ? event.end.substring(11, 16) : ""
  modal.classList.remove("hidden")
  startInput.focus()
}

// Save event
async function saveEvent() {
  const titleInput = document.getElementById("ev-title")
  const dateInput = document.getElementById("ev-date")
  const typeInput = document.getElementById("ev-type")
  const startInput = document.getElementById("ev-start")
  const endInput = document.getElementById("ev-end")

  if (!titleInput.value.trim()) {
    alert("Будь ласка, введіть назву")
    return
  }

  const eventData = {
    id: editingEventId,
    group_name: currentGroup,
    title: titleInput.value,
    type: typeInput.value,
    date: dateInput.value,
    start_time: startInput.value,
    end_time: endInput.value,
  }

  try {
    const response = await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    })

    if (response.ok) {
      closeModal()
      await fetchSchedule()
      renderCalendar()
    }
  } catch (error) {
    console.error("Error saving event:", error)
  }
}

async function saveEventName() {
  if (!editingEventId) return
  const input = document.getElementById("edit-name-input")
  if (!input.value.trim()) {
    alert("Введіть назву")
    return
  }

  const event = allEvents.find((e) => e.id == editingEventId)
  const eventData = {
    id: editingEventId,
    group_name: currentGroup,
    title: input.value,
    type: event.extendedProps.raw.type,
    date: event.start ? event.start.split("T")[0] : editingEventDate,
    start_time: event.start ? event.start.substring(11, 16) : "",
    end_time: event.end ? event.end.substring(11, 16) : "",
  }

  try {
    const response = await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    })

    if (response.ok) {
      document.getElementById("modal-edit-name").classList.add("hidden")
      await fetchSchedule()
      renderCalendar()
    }
  } catch (error) {
    console.error("Error saving event:", error)
  }
}

async function saveEventTime() {
  if (!editingEventId) return
  const startInput = document.getElementById("edit-time-start")
  const endInput = document.getElementById("edit-time-end")

  const event = allEvents.find((e) => e.id == editingEventId)
  const eventData = {
    id: editingEventId,
    group_name: currentGroup,
    title: event.title,
    type: event.extendedProps.raw.type,
    date: event.start ? event.start.split("T")[0] : editingEventDate,
    start_time: startInput.value,
    end_time: endInput.value,
  }

  try {
    const response = await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    })

    if (response.ok) {
      document.getElementById("modal-edit-time").classList.add("hidden")
      await fetchSchedule()
      renderCalendar()
    }
  } catch (error) {
    console.error("Error saving event:", error)
  }
}

// Delete event
async function deleteEvent() {
  if (!editingEventId || !confirm("Ви впевнені?")) return

  try {
    const response = await fetch(`/api/event/${editingEventId}`, {
      method: "DELETE",
    })

    if (response.ok) {
      document.getElementById("event-context-menu").classList.add("hidden")
      await fetchSchedule()
      renderCalendar()
    }
  } catch (error) {
    console.error("Error deleting event:", error)
  }
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById("today-btn").addEventListener("click", () => {
    currentDate = new Date()
    renderCalendar()
  })

  document.getElementById("prev-month").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() - 1)
    renderCalendar()
  })

  document.getElementById("next-month").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() + 1)
    renderCalendar()
  })

  document.getElementById("add-event-btn").addEventListener("click", () => {
    document.getElementById("empty-context-menu").classList.add("hidden")
    openFullModal(editingEventDate)
  })

  document.getElementById("edit-event-btn").addEventListener("click", () => {
    document.getElementById("event-context-menu").classList.add("hidden")
    openEditNameModal()
  })

  document.getElementById("edit-time-btn").addEventListener("click", () => {
    document.getElementById("event-context-menu").classList.add("hidden")
    openEditTimeModal()
  })

  document.getElementById("delete-event-btn").addEventListener("click", deleteEvent)

  // Modal handlers
  document.getElementById("save-ev").addEventListener("click", saveEvent)
  document.getElementById("cancel-ev").addEventListener("click", closeModal)
  document.querySelector(".modal-close").addEventListener("click", closeModal)
  document.querySelector(".modal-overlay").addEventListener("click", closeModal)

  document.getElementById("save-edit-name").addEventListener("click", saveEventName)
  document.getElementById("cancel-edit-name").addEventListener("click", () => {
    document.getElementById("modal-edit-name").classList.add("hidden")
  })
  document.querySelector("#modal-edit-name .modal-close").addEventListener("click", () => {
    document.getElementById("modal-edit-name").classList.add("hidden")
  })
  document.querySelector("#modal-edit-name .modal-overlay").addEventListener("click", () => {
    document.getElementById("modal-edit-name").classList.add("hidden")
  })

  document.getElementById("save-edit-time").addEventListener("click", saveEventTime)
  document.getElementById("cancel-edit-time").addEventListener("click", () => {
    document.getElementById("modal-edit-time").classList.add("hidden")
  })
  document.querySelector("#modal-edit-time .modal-close").addEventListener("click", () => {
    document.getElementById("modal-edit-time").classList.add("hidden")
  })
  document.querySelector("#modal-edit-time .modal-overlay").addEventListener("click", () => {
    document.getElementById("modal-edit-time").classList.add("hidden")
  })
}

function setupSubgroupSwitcher() {
  const btn1 = document.getElementById("subgroup-btn-1")
  const btn2 = document.getElementById("subgroup-btn-2")

  // встановимо data-subgroup якщо нема
  btn1.dataset.subgroup = btn1.dataset.subgroup || "1"
  btn2.dataset.subgroup = btn2.dataset.subgroup || "2"

  // загальний handler, використовує data-subgroup
  function switchHandler(e) {
    const target = e.currentTarget
    const sg = parseInt(target.dataset.subgroup, 10) || 1
    currentSubgroup = sg
    updateSubgroupUI()
    // збереження в бекенд
    saveUserSubgroup(sg).then(() => {
      // оновимо події після успішного збереження
      fetchSchedule().then(() => renderCalendar())
    }).catch(() => {
      // навіть якщо не вдалось зберегти — оновимо UI
      fetchSchedule().then(() => renderCalendar())
    })
  }

  btn1.removeEventListener('click', btn1._v0_handler)
  btn2.removeEventListener('click', btn2._v0_handler)

  btn1._v0_handler = switchHandler
  btn2._v0_handler = switchHandler

  btn1.addEventListener("click", btn1._v0_handler)
  btn2.addEventListener("click", btn2._v0_handler)
}


function updateSubgroupUI() {
  const btn1 = document.getElementById("subgroup-btn-1")
  const btn2 = document.getElementById("subgroup-btn-2")

  if (currentSubgroup === 1) {
    btn1.classList.add("subgroup-active")
    btn2.classList.remove("subgroup-active")
  } else {
    btn1.classList.remove("subgroup-active")
    btn2.classList.add("subgroup-active")
  }
}

async function saveUserSubgroup(subgroup) {
  try {
    const response = await fetch("/api/user/subgroup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subgroup })
    })
    if (!response.ok) {
      console.error("[v0] Failed to save subgroup")
      return false
    }
    const data = await response.json()
    if (data && data.success) {
      // оновимо локальне значення
      window.CURRENT_USER_SUBGROUP = data.subgroup
      return true
    }
    return false
  } catch (error) {
    console.error("[v0] Error saving subgroup:", error)
    return false
  }
}


// Initialize on load
if (currentGroup) {
  initCalendar()
} else {
  console.log("Waiting for group selection...")
}


// Показати view-only модал для пар розкладу
function openViewModal(event) {
  // Створимо простий modal на льоту або використаємо існуючий #modal але в режимі readonly
  // Ми будемо використати #modal як view-only: сховаємо кнопки збереження
  const modal = document.getElementById("modal")
  const title = document.getElementById("modal-title")
  const titleInput = document.getElementById("ev-title")
  const dateInput = document.getElementById("ev-date")
  const typeInput = document.getElementById("ev-type")
  const startInput = document.getElementById("ev-start")
  const endInput = document.getElementById("ev-end")
  const saveBtn = document.getElementById("save-ev")
  const cancelBtn = document.getElementById("cancel-ev")

  // Заповнимо значення
  title.textContent = "Інформація про пару"
  titleInput.value = event.title || ""
  dateInput.value = event.start ? event.start.split("T")[0] : ""
  typeInput.value = event.extendedProps && event.extendedProps.type ? event.extendedProps.type : "other"
  startInput.value = event.start ? event.start.substring(11,16) : ""
  endInput.value = event.end ? event.end.substring(11,16) : ""

  // Робимо поля readonly / disabled
  titleInput.setAttribute("disabled", "disabled")
  dateInput.setAttribute("disabled", "disabled")
  typeInput.setAttribute("disabled", "disabled")
  startInput.setAttribute("disabled", "disabled")
  endInput.setAttribute("disabled", "disabled")

  // Приховати кнопку збереження (щоб не можна було змінити)
  saveBtn.style.display = "none"
  cancelBtn.textContent = "Закрити"

  // Збережемо стан щоб відновити при закритті
  modal._v0_view_mode = true

  modal.classList.remove("hidden")
}
