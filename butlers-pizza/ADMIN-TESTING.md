# Local admin demo

This prototype is for testing the editor in one browser only. It is not a secure admin system: account data, password hashes, sessions, and content are stored in browser storage, so a visitor with access to the browser can bypass the login or change the data. Changes do not publish to other browsers or devices.

## Try it

1. Serve the `butlers-pizza` folder from a local web server. The editor uses same-origin page previews and does not work reliably from `file://`.
2. Open any site page and press `Ctrl+A`, then `D` while still holding `Ctrl`. The same shortcut opens `admin.html` directly.
3. On first use, create a local admin account. The password itself is not stored; the demo stores a salted password hash in this browser.
4. Sign in, choose a page, then click text in the preview to edit it in place. Click an image to select it; drop an image onto the image or the left-panel drop area, or choose a file. Local image files must be PNG, JPEG, WebP, or GIF and under 1 MB.
5. Click a link in the footer or page to edit its label or destination. Click a menu item to edit its details. Use **Manage menu items and specials** to add or remove rows, then save the list.
6. Edits are saved to this browser's local storage and appear on the public pages when opened in the same browser and origin.

The password-reset button generates a short-lived reset link on screen; it does not send email. The shortcut is only a convenience, not an access control. Do not use real credentials or rely on this demo for a public website. A production version needs server-side authentication, authorization, content storage, and a configured email provider.
