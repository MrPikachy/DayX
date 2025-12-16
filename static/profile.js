document.getElementById("btn-upload-avatar").addEventListener("click", () => {
  document.getElementById("avatar-input").click()
})

document.getElementById("avatar-input").addEventListener("change", (e) => {
  const file = e.target.files[0]
  if (file) {
    console.log("[v0] Starting avatar upload for file:", file.name)
    const formData = new FormData()
    formData.append("avatar", file)

    fetch("/api/user/avatar", {
      method: "POST",
      body: formData,
    })
      .then((r) => {
        console.log("[v0] Avatar upload response status:", r.status)
        return r.json()
      })
      .then((data) => {
        console.log("[v0] Avatar upload response:", data)
        if (data.success) {
          const reader = new FileReader()
          reader.onload = (event) => {
            console.log("[v0] Avatar loaded successfully")
            document.getElementById("avatar-image").src = event.target.result
          }
          reader.readAsDataURL(file)
        } else {
          console.error("[v0] Avatar upload failed:", data.error)
          alert("Помилка при завантаженні аватарки: " + (data.error || "Unknown error"))
        }
      })
      .catch((err) => {
        console.error("[v0] Avatar upload error:", err)
        alert("Помилка при завантаженні: " + err.message)
      })
  }
})
