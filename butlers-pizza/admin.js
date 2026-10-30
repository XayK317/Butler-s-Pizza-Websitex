(() => {
    const accountKey = "butlersPizzaLocalDemoAccountV1";
    const sessionKey = "butlersPizzaLocalDemoSessionV1";
    const accountChangeSessionKey = "butlersPizzaLocalDemoAccountChangeUntilV1";
    const iterationCount = 210000;

    const authPanel = document.querySelector("#auth-panel");
    const setupForm = document.querySelector("#setup-form");
    const loginForm = document.querySelector("#login-form");
    const resetForm = document.querySelector("#reset-form");
    const editorShell = document.querySelector("#editor-shell");
    const loginMessage = document.querySelector("#login-message");
    const adminPrompt = document.querySelector("#admin-prompt");
    const resetMessage = document.querySelector("#reset-message");
    const accountManager = document.querySelector("#account-manager");
    const accountEmailDisplay = document.querySelector("#account-email-display");
    const accountChangeStart = document.querySelector("#account-change-start");
    const accountChangeFlow = document.querySelector("#account-change-flow");
    const accountConfirmationButton = document.querySelector("#account-confirmation-button");
    const accountChangeMessage = document.querySelector("#account-change-message");
    const accountChangeForm = document.querySelector("#account-change-form");
    const preview = document.querySelector("#page-preview");
    const pageSelect = document.querySelector("#page-select");
    const selectionTitle = document.querySelector("#selection-title");
    const selectionHint = document.querySelector("#selection-hint");
    const selectionMessage = document.querySelector("#selection-message");
    const imageTools = document.querySelector("#image-tools");
    const imageFile = document.querySelector("#image-file");
    const imageUrl = document.querySelector("#image-url");
    const imageAlt = document.querySelector("#image-alt");
    const imageDropZone = document.querySelector("#image-drop-zone");
    const linkTools = document.querySelector("#link-tools");
    const itemTools = document.querySelector("#item-tools");
    const cropTools = document.querySelector("#crop-tools");
    const cropX = document.querySelector("#crop-x");
    const cropY = document.querySelector("#crop-y");
    const cropZoom = document.querySelector("#crop-zoom");
    const contentApi = window.ButlersAdminContent;
    const photoDownloads = document.querySelector("#photo-downloads");
    const photoDownloadStatus = document.querySelector("#photo-download-status");
    let activeResetToken = "";
    let activeSelection = null;

    const showMessage = (element, message) => {
        element.textContent = message;
        element.hidden = false;
    };

    const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

    const createSalt = () => {
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        return bytesToBase64(salt);
    };

    const hashSecret = async (secret, saltValue) => {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            "PBKDF2",
            false,
            ["deriveBits"]
        );
        const hash = await crypto.subtle.deriveBits({
            name: "PBKDF2",
            salt: Uint8Array.from(atob(saltValue), (character) => character.charCodeAt(0)),
            iterations: iterationCount,
            hash: "SHA-256"
        }, keyMaterial, 256);
        return bytesToBase64(hash);
    };

    const createToken = () => {
        const token = new Uint8Array(32);
        crypto.getRandomValues(token);
        return bytesToBase64(token).replace(/[+/=]/g, (character) => ({
            "+": "-",
            "/": "_",
            "=": ""
        })[character]);
    };

    const readAccount = () => {
        const storedAccount = localStorage.getItem(accountKey);
        return storedAccount ? JSON.parse(storedAccount) : null;
    };

    const hasAccountChangeAuthorization = () => {
        const authorizedUntil = Number(sessionStorage.getItem(accountChangeSessionKey));
        return authorizedUntil > Date.now();
    };

    const renderAccountSettings = () => {
        const account = readAccount();
        accountEmailDisplay.textContent = account
            ? `Current admin email: ${account.email}`
            : "No local admin account was found.";
        const authorized = hasAccountChangeAuthorization();
        if (authorized) {
            accountChangeFlow.dataset.open = "true";
        }
        const flowOpen = accountChangeFlow.dataset.open === "true" || authorized;
        accountChangeFlow.hidden = !flowOpen;
        accountManager.open = accountManager.open || authorized;
        accountConfirmationButton.hidden = authorized;
        accountChangeForm.hidden = !authorized;
        if (authorized) {
            accountChangeForm.elements.email.value = account?.email || "";
        }
    };

    const showLogin = () => {
        authPanel.hidden = false;
        setupForm.hidden = true;
        resetForm.hidden = true;
        loginForm.hidden = false;
        editorShell.hidden = true;
    };

    const showEditor = () => {
        authPanel.hidden = true;
        editorShell.hidden = false;
        renderAccountSettings();
        loadSelectedPage();
    };

    const consumeAccountChangeConfirmation = async (account) => {
        const params = new URLSearchParams(location.search);
        const token = params.get("confirm-login-change");
        if (!token) {
            return { handled: false, valid: false };
        }

        history.replaceState(null, "", location.pathname);
        let tokenIsValid = false;
        try {
            tokenIsValid = Boolean(account?.loginChangeTokenHash
                && account.loginChangeExpires > Date.now()
                && account.loginChangeRequestedEmail === account.email
                && sessionStorage.getItem(sessionKey) === "active"
                && await hashSecret(token, account.loginChangeTokenSalt) === account.loginChangeTokenHash);
        } catch (error) {
            console.error("Could not verify the local account-change confirmation.", error);
            return {
                handled: true,
                valid: false,
                message: "Could not verify confirmation in this browser."
            };
        }
        if (!tokenIsValid) {
            return {
                handled: true,
                valid: false,
                message: "This account-change confirmation is invalid or has expired. Request a new one while logged in."
            };
        }

        delete account.loginChangeTokenHash;
        delete account.loginChangeTokenSalt;
        delete account.loginChangeExpires;
        delete account.loginChangeRequestedEmail;
        try {
            localStorage.setItem(accountKey, JSON.stringify(account));
            sessionStorage.setItem(accountChangeSessionKey, String(Date.now() + 10 * 60 * 1000));
            return { handled: true, valid: true };
        } catch (error) {
            console.error("Could not confirm the local admin account change.", error);
            return {
                handled: true,
                valid: false,
                message: "Could not save confirmation in this browser."
            };
        }
    };

    const setPassword = async (account, password) => {
        const salt = createSalt();
        account.salt = salt;
        account.passwordHash = await hashSecret(password, salt);
        account.iterations = iterationCount;
    };

    const setResetView = async () => {
        const token = new URLSearchParams(location.search).get("reset");
        if (!token) {
            return false;
        }
        const account = readAccount();
        const resetValid = account?.resetTokenHash
            && account.resetExpires > Date.now()
            && await hashSecret(token, account.resetSalt) === account.resetTokenHash;
        if (!resetValid) {
            showLogin();
            showMessage(resetMessage, "This local reset link is invalid or has expired.");
            return true;
        }
        activeResetToken = token;
        authPanel.hidden = false;
        setupForm.hidden = true;
        loginForm.hidden = true;
        resetForm.hidden = false;
        editorShell.hidden = true;
        return true;
    };

    const currentPageContent = (content, key) => {
        if (!content[key]) {
            content[key] = { fields: {}, lists: {} };
        }
        if (!content[key].fields) {
            content[key].fields = {};
        }
        if (!content[key].lists) {
            content[key].lists = {};
        }
        return content[key];
    };

    const readListItem = (item) => {
        if (item.matches("li")) {
            return {
                title: item.querySelector("span")?.textContent.trim() || "",
                description: "",
                price: item.querySelector("strong")?.textContent.trim() || ""
            };
        }
        return {
            title: item.querySelector(".item-text h3")?.textContent.trim() || "",
            description: Array.from(item.querySelectorAll(".item-text p"))
                .map((paragraph) => paragraph.textContent.trim())
                .filter(Boolean)
                .join("\n"),
            price: item.querySelector(".item-price")?.textContent.trim() || ""
        };
    };

    const newItemDefaults = {
        menu: { title: "NEW ITEM", description: "Describe this item.", price: "$0.00" },
        coupon: { title: "NEW DEAL", description: "Describe this deal.", price: "" },
        discount: { title: "New Discount", description: "", price: "10%" }
    };

    const addLabels = { menu: "+ Add item", coupon: "+ Add deal", discount: "+ Add discount" };

    const saveGroupRecords = (group, pageKey) => {
        try {
            const content = contentApi.readOverrides();
            const records = Array.from(group.node.querySelectorAll(group.itemSelector)).map(readListItem);
            contentApi.saveGroupRecords(content, pageKey, group.node.ownerDocument, group, records);
            localStorage.setItem(contentApi.storageKey, JSON.stringify(content));
            return true;
        } catch (error) {
            console.error("Could not save this section.", error);
            showMessage(selectionMessage, "Could not save this change. Browser storage may be full or unavailable.");
            return false;
        }
    };

    const galleryGroupFor = (doc, pageApi, node) => pageApi.getGalleryGroups(doc)
        .find((group) => Array.from(group.node.querySelectorAll(group.itemSelector)).some((item) => item.contains(node)));

    const saveGalleryRecords = (group, pageKey, pageApi) => {
        try {
            const content = contentApi.readOverrides();
            const pageContent = currentPageContent(content, pageKey);
            pageContent.galleries = pageContent.galleries || {};
            pageContent.galleries[group.id] = Array.from(group.node.querySelectorAll(group.itemSelector))
                .map(pageApi.readGalleryRecord);
            localStorage.setItem(contentApi.storageKey, JSON.stringify(content));
            return true;
        } catch (error) {
            console.error("Could not save this gallery.", error);
            showMessage(selectionMessage, "Could not save this change. Browser storage may be full or unavailable.");
            return false;
        }
    };

    const refreshGalleryControls = (doc, pageApi) => {
        pageApi.getGalleryGroups(doc).forEach((group) => {
            const count = group.node.querySelectorAll(group.itemSelector).length;
            const canDelete = count > group.minimum;
            if (group.kind === "carousel") {
                const toolbar = doc.createElement("div");
                toolbar.className = "admin-control admin-gallery-toolbar";
                toolbar.innerHTML = '<button type="button" class="admin-control admin-add-photo">+ Add photo</button>'
                    + (canDelete ? '<button type="button" class="admin-control admin-delete-photo">× Delete this photo</button>' : "");
                group.node.append(toolbar);
                return;
            }
            group.node.querySelectorAll(group.itemSelector).forEach((item) => {
                if (!canDelete) {
                    return;
                }
                item.classList.add("admin-has-controls");
                const deleteButton = doc.createElement("button");
                deleteButton.type = "button";
                deleteButton.className = "admin-control admin-delete-photo";
                deleteButton.textContent = "×";
                deleteButton.setAttribute("aria-label", "Delete this photo");
                deleteButton.title = "Delete this photo";
                item.append(deleteButton);
            });
            const addButton = doc.createElement("button");
            addButton.type = "button";
            addButton.className = "admin-control admin-add-photo";
            addButton.textContent = "+ Add photo";
            group.node.append(addButton);
        });
    };

    const addGalleryPhoto = (doc, pageApi, pageKey, button) => {
        const group = pageApi.getGalleryGroups(doc).find(({ node }) => node.contains(button));
        if (!group) {
            return;
        }
        const items = Array.from(group.node.querySelectorAll(group.itemSelector));
        const last = pageApi.readGalleryRecord(items[items.length - 1]);
        const newItem = pageApi.createGalleryItem(doc, group, { src: last.src, alt: "New photo" });
        const controls = group.node.querySelector(":scope > .carousel-controls");
        if (controls) {
            group.node.insertBefore(newItem, controls);
        } else {
            group.node.insertBefore(newItem, group.node.querySelector(":scope > .admin-add-photo"));
        }
        if (group.kind === "carousel") {
            pageApi.syncCarouselIndicators(group.node, items.length);
        }
        if (saveGalleryRecords(group, pageKey, pageApi)) {
            refreshItemControls(doc, pageApi);
            selectImage({ node: pageApi.galleryImage(newItem) }, pageKey, group, pageApi);
            selectionMessage.textContent = "Photo added and saved. Replace it with your own photo in the left panel.";
        }
    };

    const deleteGalleryPhoto = (doc, pageApi, pageKey, button) => {
        const group = pageApi.getGalleryGroups(doc).find(({ node }) => node.contains(button));
        if (!group) {
            return;
        }
        const items = Array.from(group.node.querySelectorAll(group.itemSelector));
        if (items.length <= group.minimum) {
            return;
        }
        const item = group.kind === "carousel"
            ? (items.find((slide) => !slide.hidden) || items[0])
            : button.parentElement;
        const index = items.indexOf(item);
        if (activeSelection?.node && item.contains(activeSelection.node)) {
            clearItemSelection();
            imageTools.hidden = true;
        }
        item.remove();
        if (group.kind === "carousel") {
            pageApi.syncCarouselIndicators(group.node, Math.max(0, index - 1));
        }
        if (saveGalleryRecords(group, pageKey, pageApi)) {
            refreshItemControls(doc, pageApi);
            selectionMessage.textContent = "Photo deleted and saved.";
        }
    };

    const refreshItemControls = (doc, pageApi) => {
        doc.querySelectorAll(".admin-control").forEach((control) => control.remove());
        refreshGalleryControls(doc, pageApi);
        pageApi.getPosterGroups(doc).forEach((group) => {
            const items = Array.from(group.node.querySelectorAll(group.itemSelector));
            if (items.length > 1) {
                items.forEach((item) => {
                    item.classList.add("admin-has-controls");
                    const deleteButton = doc.createElement("button");
                    deleteButton.type = "button";
                    deleteButton.className = "admin-control admin-delete-item admin-poster-delete";
                    deleteButton.textContent = "×";
                    deleteButton.setAttribute("aria-label", "Delete this row");
                    deleteButton.title = "Delete this row";
                    item.append(deleteButton);
                });
            }
            const addWrap = doc.createElement("div");
            addWrap.className = "admin-control admin-poster-add-wrap";
            addWrap.innerHTML = '<button type="button" class="admin-control admin-add-item admin-poster-add">+ Add row</button>';
            group.node.append(addWrap);
        });
        pageApi.getManagedGroups(doc).forEach((group) => {
            group.node.querySelectorAll(group.itemSelector).forEach((item) => {
                item.classList.add("admin-has-controls");
                const deleteButton = doc.createElement("button");
                deleteButton.type = "button";
                deleteButton.className = "admin-control admin-delete-item";
                deleteButton.textContent = "×";
                deleteButton.setAttribute("aria-label", "Delete this item");
                deleteButton.title = "Delete this item";
                item.append(deleteButton);
            });
            const addButton = doc.createElement("button");
            addButton.type = "button";
            addButton.className = "admin-control admin-add-item";
            addButton.textContent = addLabels[group.kind];
            if (group.kind === "discount") {
                group.node.after(addButton);
            } else {
                group.node.append(addButton);
            }
        });
    };

    const resetSelection = () => {
        clearItemSelection();
        imageTools.hidden = true;
        cropTools.hidden = true;
        linkTools.hidden = true;
        selectionHint.textContent = "Click a heading or paragraph in the preview to edit it in place. Select an image to replace it, or click a menu item to edit its details. Use + to add an item to a section and × to delete one.";
        selectionMessage.textContent = "";
    };

    const clearItemSelection = () => {
        hideSelectedOutline();
        activeSelection = null;
        itemTools.hidden = true;
        selectionTitle.textContent = "Edit the page";
    };

    const addGroupItem = (doc, pageApi, pageKey, addButton) => {
        const group = pageApi.getManagedGroups(doc).find(({ node }) => node === addButton.parentElement
            || node.nextElementSibling === addButton);
        if (!group) {
            return;
        }
        const newItem = pageApi.createGroupItem(doc, group, newItemDefaults[group.kind]);
        if (group.kind === "discount") {
            group.node.append(newItem);
        } else {
            const links = group.node.querySelector(":scope > .menu-page-links");
            group.node.insertBefore(newItem, links || addButton);
        }
        if (saveGroupRecords(group, pageKey)) {
            refreshItemControls(doc, pageApi);
            selectMenuItem(newItem, group, pageKey, pageApi);
            newItem.scrollIntoView({ block: "center", behavior: "smooth" });
            selectionMessage.textContent = "Added and saved. Edit its details in the left panel.";
        }
    };

    const deleteGroupItem = (doc, pageApi, pageKey, deleteButton) => {
        const item = deleteButton.parentElement;
        const group = pageApi.getManagedGroups(doc).find(({ node }) => node.contains(item));
        if (!group) {
            return;
        }
        if (activeSelection?.node === item) {
            clearItemSelection();
        }
        item.remove();
        if (saveGroupRecords(group, pageKey)) {
            refreshItemControls(doc, pageApi);
            selectionMessage.textContent = "Item deleted and saved.";
        }
    };

    const savePosterRows = (group, pageKey, pageApi) => {
        try {
            const content = contentApi.readOverrides();
            const pageContent = currentPageContent(content, pageKey);
            pageContent.posterRows = pageContent.posterRows || {};
            pageContent.posterRows[group.id] = Array.from(group.node.querySelectorAll(group.itemSelector))
                .map(pageApi.readPosterRow);
            localStorage.setItem(contentApi.storageKey, JSON.stringify(content));
            selectionMessage.textContent = "Saved in this browser.";
            return true;
        } catch (error) {
            console.error("Could not save this section.", error);
            showMessage(selectionMessage, "Could not save this change. Browser storage may be full or unavailable.");
            return false;
        }
    };

    const addPosterRow = (doc, pageApi, pageKey, button) => {
        const group = pageApi.getPosterGroups(doc).find(({ node }) => node === button.parentElement.parentElement);
        if (!group) {
            return;
        }
        const newItem = pageApi.createPosterRow(doc, group);
        group.node.insertBefore(newItem, button.parentElement);
        if (savePosterRows(group, pageKey, pageApi)) {
            refreshItemControls(doc, pageApi);
            selectionMessage.textContent = "Row added and saved. Click its text to edit it.";
        }
    };

    const deletePosterRow = (doc, pageApi, pageKey, button) => {
        const item = button.parentElement;
        const group = pageApi.getPosterGroups(doc).find(({ node }) => node === item.parentElement);
        if (!group || group.node.querySelectorAll(group.itemSelector).length <= 1) {
            return;
        }
        if (activeSelection?.node && item.contains(activeSelection.node)) {
            clearItemSelection();
        }
        item.remove();
        if (savePosterRows(group, pageKey, pageApi)) {
            refreshItemControls(doc, pageApi);
            selectionMessage.textContent = "Row deleted and saved.";
        }
    };

    const setDownloadsEnabled = (enabled) => {
        photoDownloads.querySelectorAll("button").forEach((button) => {
            button.disabled = !enabled;
        });
        photoDownloadStatus.textContent = enabled
            ? "Your saved edits are ready. Download the updated photos."
            : "Save an edit to enable the downloads.";
    };

    const posterToBlob = (poster) => new Promise((resolve, reject) => {
        const clone = poster.cloneNode(true);
            const sourceImages = Array.from(poster.querySelectorAll("img"));
            // Images inside an SVG render must be embedded, so convert each one to a data URL.
            clone.querySelectorAll("img").forEach((img, index) => {
                const source = sourceImages[index];
                if (!source?.naturalWidth) {
                    return;
                }
                try {
                    const copy = document.createElement("canvas");
                    copy.width = source.naturalWidth;
                    copy.height = source.naturalHeight;
                    copy.getContext("2d").drawImage(source, 0, 0);
                    img.setAttribute("src", copy.toDataURL("image/jpeg", 0.92));
                } catch (error) {
                    console.error("Could not embed picture.", error);
                }
            });
        clone.querySelectorAll(".admin-control").forEach((node) => node.remove());
        [clone, ...clone.querySelectorAll("*")].forEach((node) => {
            node.classList.remove("admin-edit-selected", "admin-has-controls");
            node.removeAttribute("contenteditable");
            if (!node.getAttribute("class")) {
                node.removeAttribute("class");
            }
        });
        clone.style.transform = "";
        const doc = poster.ownerDocument;
        const css = doc.querySelector("#poster-style").textContent + (doc.defaultView.MENU_PHOTO_FONT || "");
        const body = new XMLSerializer().serializeToString(clone);
        const height = poster.offsetHeight || 768;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1365" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css.replace(/\]\]>/g, "")}</style>${body}</div></foreignObject></svg>`;
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 2730;
            canvas.height = height * 2;
            const context = canvas.getContext("2d");
            context.scale(2, 2);
            context.drawImage(image, 0, 0, 1365, height);
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image."))), "image/png");
        };
        image.onerror = () => reject(new Error("Could not render the photo."));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

    const downloadPosters = async (which) => {
        const posters = Array.from(preview.contentDocument?.querySelectorAll(".poster") || []);
        const chosen = which === "all" ? posters : [posters[Number(which)]].filter(Boolean);
        const fileName = (poster) => `${poster.dataset.poster || "Menu Photo"}.png`;
        const canPick = typeof window.showSaveFilePicker === "function" && typeof window.showDirectoryPicker === "function";
        try {
            // Pickers must open straight from the click, before the slower image rendering.
            let targets = null;
            if (canPick) {
                if (which === "all") {
                    const folder = await window.showDirectoryPicker({ mode: "readwrite" });
                    targets = await Promise.all(chosen.map((poster) => folder.getFileHandle(fileName(poster), { create: true })));
                } else {
                    targets = [await window.showSaveFilePicker({
                        suggestedName: fileName(chosen[0]),
                        types: [{ description: "PNG image", accept: { "image/png": [".png"] } }]
                    })];
                }
            }
            photoDownloadStatus.textContent = "Preparing download...";
            for (const [index, poster] of chosen.entries()) {
                const blob = await posterToBlob(poster);
                if (targets) {
                    const writable = await targets[index].createWritable();
                    await writable.write(blob);
                    await writable.close();
                    continue;
                }
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = fileName(poster);
                document.body.append(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(link.href), 4000);
            }
            photoDownloadStatus.textContent = "Saved to the location you chose.";
        } catch (error) {
            if (error?.name === "AbortError") {
                photoDownloadStatus.textContent = "Download cancelled.";
                return;
            }
            console.error(error);
            photoDownloadStatus.textContent = "Could not create the download. Try again.";
        }
    };

    const renderEditor = () => {
        const doc = preview.contentDocument;
        const pageApi = preview.contentWindow.ButlersAdminContent;
        if (!doc || !pageApi) {
            selectionMessage.textContent = "The preview did not load the content editor helper.";
            return;
        }
        const pageKey = pageApi.pageKey(doc);
        photoDownloads.hidden = pageKey !== "menu-photos.html";
        if (!photoDownloads.hidden) {
            const saved = pageApi.readOverrides()[pageKey];
            setDownloadsEnabled(Boolean(saved && (Object.keys(saved.fields || {}).length || Object.keys(saved.posterRows || {}).length)));
        }
        selectionTitle.textContent = "Edit the page";
        selectionHint.textContent = "Click a heading or paragraph in the preview to edit it in place. Select an image to replace it, or click a menu item to edit its details. Use + to add an item to a section and × to delete one.";
        selectionMessage.textContent = "";
        imageTools.hidden = true;
        linkTools.hidden = true;
        itemTools.hidden = true;
        activeSelection = null;
        attachPreviewEditor(doc, pageApi, pageKey);
    };

    const saveField = (pageKey, fieldId, updates) => {
        let content;
        try {
            content = contentApi.readOverrides();
            const pageContent = currentPageContent(content, pageKey);
            pageContent.fields[fieldId] = {
                ...pageContent.fields[fieldId],
                ...updates
            };
            localStorage.setItem(contentApi.storageKey, JSON.stringify(content));
            selectionMessage.textContent = "Saved in this browser.";
        } catch (error) {
            console.error("Could not save edited page content.", error);
            selectionMessage.textContent = "Could not save this edit. Browser storage may be full or unavailable.";
        }
    };

    const hideSelectedOutline = () => {
        activeSelection?.node?.ownerDocument.querySelectorAll(".admin-crop-frame").forEach((frame) => frame.remove());
        if (activeSelection?.node) {
            activeSelection.node.classList.remove("admin-edit-selected");
            activeSelection.node.removeAttribute("contenteditable");
            activeSelection.node.removeAttribute("data-admin-editing");
        }
    };

    const addSelectionFrame = (node) => {
        const doc = node.ownerDocument;
        const win = doc.defaultView;
        const frame = doc.createElement("div");
        frame.className = "admin-control admin-crop-frame";
        frame.innerHTML = '<svg width="100%" height="100%" aria-hidden="true"><rect x="0" y="0" width="100%" height="100%" fill="none"></rect></svg>';
        frame.style.inset = "auto";
        frame.style.zIndex = "50";
        doc.body.append(frame);
        const place = () => {
            if (!frame.isConnected) {
                return;
            }
            const rect = node.getBoundingClientRect();
            frame.style.left = `${rect.left + win.scrollX - 4}px`;
            frame.style.top = `${rect.top + win.scrollY - 4}px`;
            frame.style.width = `${rect.width + 8}px`;
            frame.style.height = `${rect.height + 8}px`;
            win.requestAnimationFrame(place);
        };
        place();
    };

    const selectImage = (field, pageKey, group = null, pageApi = null) => {
        hideSelectedOutline();
        activeSelection = { type: "image", node: field.node, field, pageKey, group, pageApi };
        field.node.classList.add("admin-edit-selected");
        selectionTitle.textContent = "Replace this image";
        selectionHint.textContent = "Drop an image onto the selected image or the box below, or choose a file. You can also enter a local path or web URL.";
        selectionMessage.textContent = "";
        imageTools.hidden = false;
        linkTools.hidden = true;
        itemTools.hidden = true;
        imageFile.value = "";
        imageUrl.value = "";
        imageAlt.value = field.node.alt || "";
        const croppable = Boolean(group || field.node.closest(".about-team-photo, .poster-art"));
        cropTools.hidden = !croppable;
        if (croppable) {
            const doc = field.node.ownerDocument;
            const frame = doc.createElement("div");
            frame.className = "admin-control admin-crop-frame";
            frame.innerHTML = '<svg width="100%" height="100%" aria-hidden="true"><rect x="0" y="0" width="100%" height="100%" fill="none"></rect></svg>';
            field.node.parentElement.classList.add("admin-has-controls");
            field.node.parentElement.append(frame);
            const crop = pageApi.readCrop(field.node);
            cropX.value = crop.x;
            cropY.value = crop.y;
            cropZoom.value = crop.zoom;
        }
    };

    const selectLink = (field, pageKey) => {
        hideSelectedOutline();
        activeSelection = { type: "link", node: field.node, field, pageKey };
        field.node.classList.add("admin-edit-selected");
        addSelectionFrame(field.node);
        selectionTitle.textContent = "Edit link";
        selectionHint.textContent = "Update the link text or its destination in the left panel.";
        selectionMessage.textContent = "";
        imageTools.hidden = true;
        linkTools.hidden = false;
        itemTools.hidden = true;
        document.querySelector("#link-text").value = field.node.textContent.trim();
        document.querySelector("#link-href").value = field.node.getAttribute("href") || "";
    };

    const selectMenuItem = (item, group, pageKey, pageApi) => {
        hideSelectedOutline();
        activeSelection = { type: "item", node: item, group, pageKey, pageApi };
        item.classList.add("admin-edit-selected");
        addSelectionFrame(item);
        selectionTitle.textContent = "Edit menu item";
        selectionHint.textContent = "Edit this item's title, description, or price here.";
        selectionMessage.textContent = "";
        imageTools.hidden = true;
        linkTools.hidden = true;
        itemTools.hidden = false;
        document.querySelector("#item-title").value = readListItem(item).title;
        document.querySelector("#item-description").value = Array.from(item.querySelectorAll(".item-text p"))
            .map((paragraph) => paragraph.textContent.trim())
            .join("\n");
        document.querySelector("#item-price").value = readListItem(item).price;
        document.querySelector("#item-description").closest("label, .field")?.toggleAttribute("hidden", group.kind === "discount");
    };

    const persistImage = async (source, alt) => {
        if (!activeSelection || activeSelection.type !== "image") {
            return;
        }
        const safeSource = contentApi.safeUrl(source, preview.contentDocument.baseURI);
        if (!safeSource || safeSource === null) {
            selectionMessage.textContent = "Use an image file, http(s) URL, or relative site path.";
            return;
        }
        activeSelection.node.setAttribute("src", safeSource);
        activeSelection.node.setAttribute("alt", alt);
        if (activeSelection.group) {
            if (saveGalleryRecords(activeSelection.group, activeSelection.pageKey, activeSelection.pageApi)) {
                selectionMessage.textContent = "Saved in this browser.";
            }
            return;
        }
        saveField(activeSelection.pageKey, activeSelection.field.id, { src: safeSource, alt });
    };

    const readImageFile = (file) => {
        if (!file || !/^image\/(?:png|jpeg|webp|gif)$/.test(file.type)) {
            selectionMessage.textContent = "Choose a PNG, JPEG, WebP, or GIF image.";
            return;
        }
        if (file.size > 1_000_000) {
            selectionMessage.textContent = "For this local demo, choose an image smaller than 1 MB.";
            return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            if (typeof reader.result === "string") {
                imageUrl.value = "";
                persistImage(reader.result, imageAlt.value);
            }
        });
        reader.addEventListener("error", () => {
            selectionMessage.textContent = "The selected image could not be read.";
        });
        reader.readAsDataURL(file);
    };

    const attachPreviewEditor = (doc, pageApi, pageKey) => {
        activeSelection = null;
        if (!doc.querySelector("#admin-preview-style")) {
            const style = doc.createElement("style");
            style.id = "admin-preview-style";
            style.textContent = ".admin-edit-selected{outline:none!important;cursor:text}.admin-edit-selected img{outline:3px solid #d13014!important;outline-offset:3px}"
                + ".admin-has-controls{position:relative}"
                + ".admin-control{font:700 14px/1 sans-serif;cursor:pointer}"
                + ".admin-delete-item{position:absolute;top:-8px;right:-8px;z-index:5;width:26px;height:26px;padding:0;border:2px solid #fff;border-radius:50%;background:#d13014;color:#fff;font-size:18px}"
                + ".admin-add-item{grid-column:1/-1;align-self:flex-start;margin:12px auto 0;padding:10px 18px;border:2px dashed #d13014;border-radius:20px;background:rgba(255,255,255,.7);color:#d13014}"
                + ".admin-add-item:hover,.admin-delete-item:hover{filter:brightness(.9)}"
                + ".admin-poster-add-wrap{grid-column:1/-1;position:relative;height:0;margin:0;padding:0;text-align:center;z-index:6}"
                + ".admin-poster-add-wrap .admin-poster-add{position:absolute;right:0;top:2px;margin:0;white-space:nowrap;padding:4px 10px;font-size:12px}"
                + ".admin-poster-delete{top:2px;right:-26px}"
                + ".admin-add-photo{grid-column:1/-1;margin:12px auto 0;padding:10px 18px;border:2px dashed #d13014;border-radius:20px;background:rgba(255,255,255,.85);color:#d13014}"
                + ".admin-delete-photo{position:absolute;top:4px;right:4px;z-index:6;width:26px;height:26px;padding:0;border:2px solid #fff;border-radius:50%;background:#d13014;color:#fff;font-size:18px}"
                + ".admin-gallery-toolbar{position:absolute;top:10px;left:10px;z-index:7;display:flex;gap:8px}"
                + ".admin-gallery-toolbar .admin-add-photo,.admin-gallery-toolbar .admin-delete-photo{position:static;width:auto;height:auto;margin:0;padding:8px 14px;border-radius:20px;font-size:14px}"
                + ".admin-crop-frame{position:absolute;inset:0;z-index:4;pointer-events:none}"
                + ".admin-crop-frame svg{display:block;overflow:visible}"
                + ".admin-crop-frame rect{stroke:#d13014;stroke-width:3;stroke-dasharray:3 8;stroke-linecap:round;animation:admin-crop-march 600ms linear infinite}"
                + "@keyframes admin-crop-march{to{stroke-dashoffset:-22}}"
                + ".admin-gallery-toolbar .admin-delete-photo{border-color:#d13014}";
            doc.head.append(style);
        }
        refreshItemControls(doc, pageApi);
        const previewNav = doc.querySelector(".site-header nav");
        if (previewNav && !previewNav.querySelector(".admin-nav-tab")) {
            const tab = doc.createElement("a");
            tab.className = "admin-nav-tab";
            tab.href = "menu-photos.html";
            tab.textContent = "MENU PICTURES";
            tab.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                pageSelect.value = "menu-photos.html";
                loadSelectedPage();
            });
            previewNav.append(tab);
        }
        if (doc.adminEditorAttached) {
            return;
        }
        doc.adminEditorAttached = true;

        doc.addEventListener("click", (event) => {
            const target = event.target?.nodeType === 1 ? event.target : null;
            if (!target) {
                return;
            }
            const control = target.closest(".admin-control");
            if (control) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (control.classList.contains("admin-add-photo")) {
                    addGalleryPhoto(doc, pageApi, pageKey, control);
                } else if (control.classList.contains("admin-delete-photo")) {
                    deleteGalleryPhoto(doc, pageApi, pageKey, control);
                } else if (control.classList.contains("admin-poster-add")) {
                    addPosterRow(doc, pageApi, pageKey, control);
                } else if (control.classList.contains("admin-poster-delete")) {
                    deletePosterRow(doc, pageApi, pageKey, control);
                } else if (control.classList.contains("admin-add-item")) {
                    addGroupItem(doc, pageApi, pageKey, control);
                } else {
                    deleteGroupItem(doc, pageApi, pageKey, control);
                }
                return;
            }
            const menuItem = target.closest(".menu-item, .discount-section li");
            if (menuItem) {
                const group = pageApi.getManagedGroups(doc).find(({ node }) => node.contains(menuItem));
                if (group) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    selectMenuItem(menuItem, group, pageKey, pageApi);
                    return;
                }
            }
            const image = target.closest("img");
            if (image && image.closest("main")) {
                const galleryGroup = galleryGroupFor(doc, pageApi, image);
                if (galleryGroup) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    selectImage({ node: image }, pageKey, galleryGroup, pageApi);
                    return;
                }
                const field = pageApi.getEditableFields(doc).find((candidate) => candidate.node === image);
                if (field) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    selectImage(field, pageKey, null, pageApi);
                    return;
                }
            }
            const link = target.closest(".media-cta, .footer-interactive a");
            if (link) {
                const field = pageApi.getEditableFields(doc).find((candidate) => candidate.kind === "link" && candidate.node === link);
                if (field) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    selectLink(field, pageKey);
                    return;
                }
            }
            const textNode = target.closest("main h1, main h2, main h3, main h4, main p, footer h2, footer h4, footer p");
            if (textNode && !textNode.closest(".menu-item")) {
                const field = pageApi.getEditableFields(doc).find((candidate) => candidate.kind === "text" && candidate.node === textNode);
                if (!field) {
                    return;
                }
                hideSelectedOutline();
                activeSelection = { type: "text", node: textNode, field, pageKey };
                textNode.classList.add("admin-edit-selected");
                addSelectionFrame(textNode);
                textNode.setAttribute("contenteditable", "true");
                textNode.setAttribute("data-admin-editing", "true");
                selectionTitle.textContent = "Edit text in the preview";
                selectionHint.textContent = "Type directly into the selected text. Click elsewhere when you are done; the edit saves automatically.";
                selectionMessage.textContent = "";
                imageTools.hidden = true;
                linkTools.hidden = true;
                itemTools.hidden = true;
                textNode.focus();
            } else if (activeSelection) {
                resetSelection();
            }
        }, true);

        doc.addEventListener("input", (event) => {
            const target = event.target;
            if (target?.nodeType === 1 && target.dataset.adminEditing === "true") {
                selectionMessage.textContent = "Editing… click elsewhere to save.";
            }
        });

        doc.addEventListener("focusout", (event) => {
            const target = event.target;
            if (target?.nodeType === 1 && target.dataset.adminEditing === "true") {
                const field = pageApi.getEditableFields(doc).find((candidate) => candidate.node === target);
                if (field) {
                    const value = target.innerText.replace(/\u00a0/g, " ").trim();
                    pageApi.setPlainText(target, value);
                    if (field.posterGroup) {
                        savePosterRows(field.posterGroup, pageKey, pageApi);
                    } else {
                        saveField(pageKey, field.id, { text: value });
                    }
                    target.removeAttribute("contenteditable");
                    target.removeAttribute("data-admin-editing");
                }
            }
        }, true);

        doc.addEventListener("dragover", (event) => {
            const image = event.target?.nodeType === 1 ? event.target.closest("img") : null;
            if (image?.closest("main")) {
                event.preventDefault();
            }
        });
        doc.addEventListener("drop", (event) => {
            const image = event.target?.nodeType === 1 ? event.target.closest("img") : null;
            const file = event.dataTransfer?.files?.[0];
            if (image?.closest("main") && file) {
                event.preventDefault();
                const galleryGroup = galleryGroupFor(doc, pageApi, image);
                if (galleryGroup) {
                    selectImage({ node: image }, pageKey, galleryGroup, pageApi);
                    readImageFile(file);
                    return;
                }
                const field = pageApi.getEditableFields(doc).find((candidate) => candidate.node === image);
                if (field) {
                    selectImage(field, pageKey, null, pageApi);
                    readImageFile(file);
                }
            }
        });
    };

    const loadSelectedPage = () => {
        const requested = new URLSearchParams(location.search).get("page");
        if (requested && !loadSelectedPage.applied) {
            loadSelectedPage.applied = true;
            if (Array.from(pageSelect.options).some((option) => option.value === requested)) {
                pageSelect.value = requested;
            }
        }
        const pageName = pageSelect.value;
        document.querySelector("#open-page-link").href = pageName;
        preview.src = `${pageName}?admin-preview=${Date.now()}`;
    };

    const initEditor = () => {
        pageSelect.addEventListener("change", loadSelectedPage);
        photoDownloads.querySelectorAll("button").forEach((button) => {
            button.addEventListener("click", () => downloadPosters(button.dataset.downloadPoster));
        });
        new MutationObserver(() => {
            if (!photoDownloads.hidden && /saved/i.test(selectionMessage.textContent)) {
                setDownloadsEnabled(true);
            }
        }).observe(selectionMessage, { childList: true, characterData: true, subtree: true });
        preview.addEventListener("load", renderEditor);
        imageFile.addEventListener("change", () => readImageFile(imageFile.files?.[0]));
        imageDropZone.addEventListener("dragover", (event) => {
            event.preventDefault();
            imageDropZone.classList.add("is-dragging");
        });
        imageDropZone.addEventListener("dragleave", () => {
            imageDropZone.classList.remove("is-dragging");
        });
        imageDropZone.addEventListener("drop", (event) => {
            event.preventDefault();
            imageDropZone.classList.remove("is-dragging");
            readImageFile(event.dataTransfer?.files?.[0]);
        });
        document.querySelector("#save-image").addEventListener("click", () => {
            persistImage(imageUrl.value, imageAlt.value);
        });
        const applySelectedCrop = (reset = false) => {
            if (activeSelection?.type !== "image" || cropTools.hidden) {
                return;
            }
            if (reset) {
                cropX.value = 50;
                cropY.value = 50;
                cropZoom.value = 100;
            }
            const crop = { x: cropX.value, y: cropY.value, zoom: cropZoom.value };
            activeSelection.pageApi.applyCrop(activeSelection.node, crop);
            if (!activeSelection.group) {
                saveField(activeSelection.pageKey, activeSelection.field.id, {
                    x: Number(crop.x),
                    y: Number(crop.y),
                    zoom: Number(crop.zoom)
                });
                return;
            }
            if (saveGalleryRecords(activeSelection.group, activeSelection.pageKey, activeSelection.pageApi)) {
                selectionMessage.textContent = "Crop saved in this browser.";
            }
        };
        [cropX, cropY, cropZoom].forEach((input) => input.addEventListener("input", () => applySelectedCrop()));
        document.querySelector("#crop-reset").addEventListener("click", () => applySelectedCrop(true));
        linkTools.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!activeSelection || activeSelection.type !== "link") {
                return;
            }
            const href = document.querySelector("#link-href").value.trim();
            if (contentApi.safeUrl(href, preview.contentDocument.baseURI) === null) {
                showMessage(selectionMessage, "Enter a valid http(s) URL or a relative site path.");
                return;
            }
            const text = document.querySelector("#link-text").value;
            activeSelection.node.textContent = text;
            activeSelection.node.setAttribute("href", href);
            saveField(activeSelection.pageKey, activeSelection.field.id, { text, href });
        });
        document.querySelector("#save-item").addEventListener("click", () => {
            if (!activeSelection || activeSelection.type !== "item") {
                return;
            }
            const groupItems = Array.from(activeSelection.group.node.querySelectorAll(activeSelection.group.itemSelector));
            const itemIndex = groupItems.indexOf(activeSelection.node);
            if (itemIndex < 0) {
                return;
            }
            const records = groupItems.map(readListItem);
            records[itemIndex] = {
                title: document.querySelector("#item-title").value.trim(),
                description: document.querySelector("#item-description").value.trim(),
                price: document.querySelector("#item-price").value.trim()
            };
            if (!records[itemIndex].title) {
                showMessage(selectionMessage, "Enter a title for this item.");
                return;
            }
            const content = contentApi.readOverrides();
            contentApi.saveGroupRecords(content, activeSelection.pageKey, activeSelection.node.ownerDocument, activeSelection.group, records);
            try {
                localStorage.setItem(contentApi.storageKey, JSON.stringify(content));
                activeSelection.pageApi.setMenuItem(activeSelection.node, records[itemIndex]);
                selectionMessage.textContent = "Item saved in this browser.";
                renderEditor();
            } catch (error) {
                console.error("Could not save this menu item.", error);
                showMessage(selectionMessage, "Could not save the item. Browser storage may be full or unavailable.");
            }
        });
    };

    const initialize = async () => {
        let account;
        try {
            account = readAccount();
        } catch (error) {
            console.error("Could not read the local demo account.", error);
            showLogin();
            showMessage(loginMessage, "The local demo account data could not be read.");
            return;
        }

        const showingReset = await setResetView();
        if (showingReset) {
            return;
        }

        const accountChangeConfirmation = await consumeAccountChangeConfirmation(account);
        if (accountChangeConfirmation.handled && !accountChangeConfirmation.valid) {
            if (sessionStorage.getItem(sessionKey) === "active") {
                accountChangeFlow.dataset.open = "true";
                showEditor();
                showMessage(accountChangeMessage, accountChangeConfirmation.message);
            } else {
                showLogin();
                showMessage(loginMessage, accountChangeConfirmation.message);
            }
            return;
        }

        if (!account) {
            setupForm.hidden = false;
            loginForm.hidden = true;
            return;
        }
        if (sessionStorage.getItem(sessionKey) === "active") {
            showEditor();
            return;
        }
        showLogin();
    };

    setupForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(setupForm);
        const email = String(formData.get("email")).trim().toLowerCase();
        const password = String(formData.get("password"));
        const confirmPassword = String(formData.get("confirm-password"));
        const message = document.querySelector("#setup-message");
        if (password.length < 12) {
            showMessage(message, "Use a password with at least 12 characters.");
            return;
        }
        if (password !== confirmPassword) {
            showMessage(message, "The passwords do not match.");
            return;
        }
        try {
            const account = { email };
            await setPassword(account, password);
            localStorage.setItem(accountKey, JSON.stringify(account));
            showLogin();
            loginForm.elements.email.value = email;
            showMessage(loginMessage, "Local admin account created. Sign in to continue.");
        } catch (error) {
            console.error("Could not create the local demo account.", error);
            showMessage(message, "Could not create the account. This browser may not support Web Crypto.");
        }
    });

    loginForm.addEventListener("input", () => {
        loginMessage.hidden = true;
        adminPrompt.hidden = true;
        loginForm.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const emailInput = loginForm.elements.email;
        const passwordInput = loginForm.elements.password;
        try {
            const account = readAccount();
            const suppliedHash = account ? await hashSecret(passwordInput.value, account.salt) : "";
            if (!account || emailInput.value.trim().toLowerCase() !== account.email || suppliedHash !== account.passwordHash) {
                emailInput.setAttribute("aria-invalid", "true");
                passwordInput.setAttribute("aria-invalid", "true");
                showMessage(loginMessage, "Wrong email or password.");
                adminPrompt.hidden = false;
                return;
            }
            sessionStorage.setItem(sessionKey, "active");
            showEditor();
        } catch (error) {
            console.error("Could not verify the local demo login.", error);
            showMessage(loginMessage, "Login could not be verified in this browser.");
        }
    });

    document.querySelector("#reset-request-button").addEventListener("click", async () => {
        const email = loginForm.elements.email.value.trim().toLowerCase();
        try {
            const account = readAccount();
            if (account && email === account.email) {
                const token = createToken();
                account.resetSalt = createSalt();
                account.resetTokenHash = await hashSecret(token, account.resetSalt);
                account.resetExpires = Date.now() + 30 * 60 * 1000;
                localStorage.setItem(accountKey, JSON.stringify(account));
                const resetUrl = new URL("admin.html", location.href);
                resetUrl.searchParams.set("reset", token);
                resetMessage.replaceChildren();
                resetMessage.append("Demo reset link (not emailed): ");
                const resetLink = document.createElement("a");
                resetLink.href = resetUrl.href;
                resetLink.textContent = "Open password reset";
                resetMessage.append(resetLink);
                resetMessage.hidden = false;
            } else {
                showMessage(resetMessage, "If this email belongs to the local admin, a reset link would be sent. This demo cannot send email.");
            }
        } catch (error) {
            console.error("Could not create the local reset link.", error);
            showMessage(resetMessage, "Could not create a reset link in this browser.");
        }
    });

    resetForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(resetForm);
        const password = String(formData.get("password"));
        const confirmPassword = String(formData.get("confirm-password"));
        const message = document.querySelector("#reset-form-message");
        if (password.length < 12 || password !== confirmPassword) {
            showMessage(message, password.length < 12
                ? "Use a password with at least 12 characters."
                : "The passwords do not match.");
            return;
        }
        try {
            const account = readAccount();
            const tokenIsValid = account?.resetTokenHash
                && account.resetExpires > Date.now()
                && await hashSecret(activeResetToken, account.resetSalt) === account.resetTokenHash;
            if (!tokenIsValid) {
                showMessage(message, "This local reset link is invalid or has expired.");
                return;
            }
            delete account.resetTokenHash;
            delete account.resetSalt;
            delete account.resetExpires;
            await setPassword(account, password);
            localStorage.setItem(accountKey, JSON.stringify(account));
            location.href = "admin.html";
        } catch (error) {
            console.error("Could not reset the local demo password.", error);
            showMessage(message, "Could not reset the password in this browser.");
        }
    });

    accountChangeStart.addEventListener("click", () => {
        accountChangeFlow.dataset.open = "true";
        renderAccountSettings();
        accountChangeMessage.hidden = true;
    });

    accountConfirmationButton.addEventListener("click", async () => {
        try {
            const account = readAccount();
            if (!account || sessionStorage.getItem(sessionKey) !== "active") {
                showMessage(accountChangeMessage, "Log in again before changing the admin account.");
                return;
            }

            const token = createToken();
            account.loginChangeTokenSalt = createSalt();
            account.loginChangeTokenHash = await hashSecret(token, account.loginChangeTokenSalt);
            account.loginChangeRequestedEmail = account.email;
            account.loginChangeExpires = Date.now() + 15 * 60 * 1000;
            localStorage.setItem(accountKey, JSON.stringify(account));

            const confirmationUrl = new URL("admin.html", location.href);
            confirmationUrl.searchParams.set("confirm-login-change", token);
            accountChangeMessage.replaceChildren();
            accountChangeMessage.append(`Demo confirmation link for ${account.email} (not emailed): `);
            const confirmationLink = document.createElement("a");
            confirmationLink.href = confirmationUrl.href;
            confirmationLink.textContent = "Confirm current email";
            accountChangeMessage.append(confirmationLink);
            accountChangeMessage.hidden = false;
        } catch (error) {
            console.error("Could not create the local account-change confirmation.", error);
            showMessage(accountChangeMessage, "Could not create a confirmation link in this browser.");
        }
    });

    accountChangeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!hasAccountChangeAuthorization()) {
            showMessage(accountChangeMessage, "Confirm the current admin email before changing this login.");
            return;
        }

        const formData = new FormData(accountChangeForm);
        const email = String(formData.get("email")).trim().toLowerCase();
        const password = String(formData.get("password"));
        const confirmPassword = String(formData.get("confirm-password"));
        if (password.length < 12) {
            showMessage(accountChangeMessage, "Use a password with at least 12 characters.");
            return;
        }
        if (password !== confirmPassword) {
            showMessage(accountChangeMessage, "The passwords do not match.");
            return;
        }

        try {
            const account = readAccount();
            if (!account) {
                showMessage(accountChangeMessage, "The local admin account could not be found.");
                return;
            }
            account.email = email;
            delete account.loginChangeTokenHash;
            delete account.loginChangeTokenSalt;
            delete account.loginChangeExpires;
            delete account.loginChangeRequestedEmail;
            await setPassword(account, password);
            localStorage.setItem(accountKey, JSON.stringify(account));
            sessionStorage.removeItem(accountChangeSessionKey);
            accountChangeForm.reset();
            renderAccountSettings();
            showMessage(accountChangeMessage, "Admin login updated. Use the new email and password next time you log in.");
        } catch (error) {
            console.error("Could not update the local admin login.", error);
            showMessage(accountChangeMessage, "Could not update the admin login. Browser storage may be unavailable.");
        }
    });

    document.querySelector("#logout-button").addEventListener("click", () => {
        sessionStorage.removeItem(sessionKey);
        sessionStorage.removeItem(accountChangeSessionKey);
        location.href = "admin.html";
    });

    initEditor();
    initialize();
})();
