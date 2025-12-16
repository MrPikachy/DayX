const LPNU_API = "https://student.lpnu.ua/students_schedule"
let currentDate = new Date()
const currentGroup = window.CURRENT_USER_GROUP
let allEvents = []
let editingEventId = null
let editingEventDate = null
let currentSubgroup = 1


function formatDate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getFirstDayOfMonth(d) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  return (first.getDay() + 6) % 7
}

async function initCalendar() {
  if (!currentGroup) {
    console.log("No group selected")
    return
  }

  setupSubgroupListeners()
  await fetchSchedule()
  renderCalendar()
  setupEventListeners()
}

function setupSubgroupListeners() {
  const buttons = document.querySelectorAll(".subgroup-btn")
  buttons.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const subgroup = e.target.dataset.subgroup
      currentSubgroup = Number.parseInt(subgroup)


      buttons.forEach((b) => b.classList.remove("subgroup-active"))
      e.target.classList.add("subgroup-active")


      await fetchSchedule()
      renderCalendar()
    })
  })
}


async function fetchSchedule() {
  try {
    const response = await fetch(`/api/schedule/${currentGroup}?subgroup=${currentSubgroup}`)
    const data = await response.json()


    const lpnuEvents = (data.schedule || []).map((e) => ({
      ...e,
      is_custom: 0,
    }))
    const customEvents = (data.custom_events || []).map((e) => ({
      ...e,
      is_custom: 1,
    }))

    allEvents = [...lpnuEvents, ...customEvents]
  } catch (error) {
    console.error("Error fetching schedule:", error)
    allEvents = []
  }
}


function getEventsForDate(dateStr) {
  return allEvents.filter((e) => {
    const eventDate = e.date || e.event_date
    return eventDate === dateStr
  })
}


function renderCalendar() {
  const monthLabel = document.getElementById("month-label")
  const calendar = document.getElementById("calendar")
  calendar.innerHTML = ""

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = getFirstDayOfMonth(currentDate)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = formatDate(new Date())


  const monthName = currentDate.toLocaleString("uk-UA", {
    month: "long",
    year: "numeric",
  })
  monthLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1)


  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement("div")
    emptyCell.className = "calendar-day empty"
    calendar.appendChild(emptyCell)
  }


  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    const dateStr = formatDate(date)
    const isToday = dateStr === today

    const dayCell = document.createElement("div")
    dayCell.className = `calendar-day ${isToday ? "today" : ""}`
    dayCell.dataset.date = dateStr


    const dayNum = document.createElement("div")
    dayNum.className = "day-number"
    dayNum.textContent = day
    dayCell.appendChild(dayNum)

    const eventsContainer = document.createElement("div")
    eventsContainer.className = "day-events"

    const dayEvents = getEventsForDate(dateStr)
    dayEvents.slice(0, 3).forEach((event) => {
      const eventEl = createEventElement(event, dateStr)
      eventsContainer.appendChild(eventEl)
    })

    if (dayEvents.length > 3) {
      const moreEl = document.createElement("div")
      moreEl.className = "day-more"
      moreEl.textContent = `+${dayEvents.length - 3}`
      eventsContainer.appendChild(moreEl)
    }

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

function createEventElement(event, dateStr) {
  const el = document.createElement("div")
  const typeClass = event.type || "other"
  const isCustom = event.is_custom

  el.className = `day-event event-${typeClass} ${isCustom ? "custom" : ""}`
  el.dataset.eventId = event.id

  const title = event.title || event.subject || event.name || "Подія"
  const startTime = event.start_time || event.time_start || ""

  let displayText = title.substring(0, 15)
  if (startTime) {
    displayText += ` ${startTime}`
  }
  el.textContent = displayText
  el.title = title

  el.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (isCustom) {
      showContextMenu("event", dateStr, event, e)
    }
  })

  return el
}

function showContextMenu(type, dateStr, event, mouseEvent) {
  const eventMenu = document.getElementById("event-context-menu")
  const emptyMenu = document.getElementById("empty-context-menu")

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


function closeModal() {
  document.getElementById("modal").classList.add("hidden")
  editingEventId = null
  editingEventDate = null
}


function openFullModal(dateStr, eventData = null) {
  const modal = document.getElementById("modal")
  const title = document.getElementById("modal-title")
  const titleInput = document.getElementById("ev-title")
  const dateInput = document.getElementById("ev-date")
  const typeInput = document.getElementById("ev-type")
  const startInput = document.getElementById("ev-start")
  const endInput = document.getElementById("ev-end")

  if (eventData && eventData.is_custom) {
    title.textContent = "Редагувати подію"
    titleInput.value = eventData.title || ""
    dateInput.value = eventData.date || dateStr
    typeInput.value = eventData.type || "other"
    startInput.value = eventData.start_time || ""
    endInput.value = eventData.end_time || ""
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
  startInput.value = event.start_time || ""
  endInput.value = event.end_time || ""
  modal.classList.remove("hidden")
  startInput.focus()
}


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
    type: event.type,
    date: event.date || editingEventDate,
    start_time: event.start_time,
    end_time: event.end_time,
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
    type: event.type,
    date: event.date || editingEventDate,
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

if (currentGroup) {
  initCalendar()
} else {
  console.log("Waiting for group selection...")
}
