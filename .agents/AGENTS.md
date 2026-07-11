# Workspace Rules - Neutralinojs Development Guardrails

Follow these strict development guidelines when working with Neutralinojs in this workspace to avoid native WebView2 permission, window dragging, process binding, or API execution errors.

---

## 1. Window Dragging & Input Interception
- **Draggable Region Constraint**: Never set the main application container (or the entire window body) as the draggable region using `Neutralino.window.setDraggableRegion()`.
- **Reason**: On Windows (WebView2), setting a large container as a draggable region causes the OS to intercept all mouse clicks at the window level, completely blocking native HTML clicks on child elements (buttons, inputs, and scroll views).
- **Correct Pattern**:
  - Add a dedicated, non-interactive top header element (e.g., `#drag-handle`) to serve as the title bar.
  - Bind dragging strictly to that header: `Neutralino.window.setDraggableRegion('drag-handle');`.
- **Deprecated APIs**: Never use the deprecated `Neutralino.window.defineMoveAction` API.

---

## 2. API Allowlist (nativeAllowList)
- **Namespace Permissions**: If the application executes any native window operations (such as `getSize`, `setSize`, or `setDraggableRegion`), you must ensure that `"window.*"` is added to the `"nativeAllowList"` array inside `neutralino.config.json`.
- **Namespace Filesystem**: If the application reads/writes local files (like reading the `.env` file via `Neutralino.filesystem.readFile`), ensure `"filesystem.*"` is added to the `"nativeAllowList"`.

---

## 3. Process & Port Management (No WMI / Non-blocking)
- **Detached Child Processes**: Child processes spawned by Neutralinojs (like background PowerShell listeners) are detached and do not automatically exit when the main app closes.
- **Port Release Check**: Always check and release the target port (e.g., port 8888) at the very start of the background script (like `auth_listener.ps1`) before attempting to bind to it.
  - *Do not use WMI queries* like `Get-CimInstance Win32_Process` in synchronous paths. WMI is prone to hanging indefinitely if the WMI service is corrupted on the user's OS, which will block the JS main thread and freeze the app UI.
  - *Use kernel TCP connection checks instead*:
    ```powershell
    $conn = Get-NetTCPConnection -LocalPort 8888 -ErrorAction SilentlyContinue
    if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }
    ```

---

## 4. Browser API Compatibility
- **External URL Open**: Use `Neutralino.os.open(url)` (requires `"os.*"` in allowlist) to open links in the default browser. Do not use `Neutralino.app.open`.
- **Session Persistence**: Use the standard browser Web Storage API (`localStorage`) to persist tokens across app launches. It is fully supported by Edge WebView2 and persists data in the user's app data directory.
- **Favicon 404 Silence**: Add `<link rel="icon" href="data:,">` inside the HTML `<head>` to prevent the embedded browser engine from attempting to request a favicon from the local server, keeping the console logs 100% clean.
