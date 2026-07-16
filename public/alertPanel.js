export function showAlert(type, message) {
let container = document.getElementById("alertContainer");
if (!container) {
container = document.createElement("div");
container.id = "alertContainer";
container.style.position = "fixed";
container.style.bottom = "24px";
container.style.right = "24px";
container.style.zIndex = "9999";
container.style.maxWidth = "400px";
document.body.appendChild(container);
}
const alert = document.createElement("div");
alert.className = `alert-box alert-${type}`;
const messageSpan = document.createElement("span");
messageSpan.style.flex = "1";
messageSpan.textContent = String(message ?? "");
const closeSpan = document.createElement("span");
closeSpan.className = "alert-close";
closeSpan.style.fontWeight = "bold";
closeSpan.style.cursor = "pointer";
closeSpan.style.marginLeft = "10px";
closeSpan.setAttribute("aria-label", "Close alert");
closeSpan.textContent = "\u00d7";
alert.append(messageSpan, closeSpan);
closeSpan.addEventListener("click", () => {
alert.remove();
});
container.appendChild(alert);
if (type !== "error") {
setTimeout(() => {
alert.style.opacity = "0";
setTimeout(() => alert.remove(), 300);
}, 6000);
}
}
