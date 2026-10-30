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
    const contentApi = window.ButlersAdminContent;
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
            const pageContent = currentPageContent(content, pageKey);
            pageContent.lists[group.id] = Array.from(group.node.querySelectorAll(group.itemSelector)).map(readListItem);
            localStorage.setItem(contentApi.storageKey, JSON.stringify(content));
            return true;
        } catch (error) {
            console.error("Could not save this section.", error);
            showMessage(selectionMessage, "Could not save this change. Browser storage may be full or unavailable.");
            return false;
        }
    };

    const refreshItemControls = (doc, pageApi) => {
        doc.querySelectorAll(".admin-control").forEach((control) => control.remove());
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
            group.node.insertBefore(newItem, addButton);
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

    const renderEditor = () => {
        const doc = preview.contentDocument;
        const pageApi = preview.contentWindow.ButlersAdminContent;
        if (!doc || !pageApi) {
            selectionMessage.textContent = "The preview did not load the content editor helper.";
            return;
        }
        const pageKey = pageApi.pageKey(doc);
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
        if (activeSelection?.node) {
            activeSelection.node.classList.remove("admin-edit-selected");
            activeSelection.node.removeAttribute("contenteditable");
            activeSelection.node.removeAttribute("data-admin-editing");
        }
    };

    const selectImage = (field, pageKey) => {
        hideSelectedOutline();
        activeSelection = { type: "image", node: field.node, field, pageKey };
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
    };

    const selectLink = (field, pageKey) => {
        hideSelectedOutline();
        activeSelection = { type: "link", node: field.node, field, pageKey };
        field.node.classList.add("admin-edit-selected");
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
            style.textContent = ".admin-edit-selected{outline:3px solid #d13014!important;outline-offset:3px;cursor:text}.admin-edit-selected img{outline:3px solid #d13014!important;outline-offset:3px}"
                + ".admin-has-controls{position:relative}"
                + ".admin-control{font:700 14px/1 sans-serif;cursor:pointer}"
                + ".admin-delete-item{position:absolute;top:-8px;right:-8px;z-index:5;width:26px;height:26px;padding:0;border:2px solid #fff;border-radius:50%;background:#d13014;color:#fff;font-size:18px}"
                + ".admin-add-item{grid-column:1/-1;align-self:flex-start;margin:12px auto 0;padding:10px 18px;border:2px dashed #d13014;border-radius:20px;background:rgba(255,255,255,.7);color:#d13014}"
                + ".admin-add-item:hover,.admin-delete-item:hover{filter:brightness(.9)}";
            doc.head.append(style);
        }
        refreshItemControls(doc, pageApi);
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
                if (control.classList.contains("admin-add-item")) {
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
                const field = pageApi.getEditableFields(doc).find((candidate) => candidate.node === image);
                if (field) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    selectImage(field, pageKey);
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
                textNode.setAttribute("contenteditable", "true");
                textNode.setAttribute("data-admin-editing", "true");
                selectionTitle.textContent = "Edit text in the preview";
                selectionHint.textContent = "Type directly into the selected text. Click elsewhere when you are done; the edit saves automatically.";
                selectionMessage.textContent = "";
                imageTools.hidden = true;
                linkTools.hidden = true;
                itemTools.hidden = true;
                textNode.focus();
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
                    saveField(pageKey, field.id, { text: value });
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
                const field = pageApi.getEditableFields(doc).find((candidate) => candidate.node === image);
                if (field) {
                    selectImage(field, pageKey);
                    readImageFile(file);
                }
            }
        });
    };

    const loadSelectedPage = () => {
        const pageName = pageSelect.value;
        document.querySelector("#open-page-link").href = pageName;
        preview.src = `${pageName}?admin-preview=${Date.now()}`;
    };

    const initEditor = () => {
        pageSelect.addEventListener("change", loadSelectedPage);
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
            const pageContent = currentPageContent(content, activeSelection.pageKey);
            pageContent.lists[activeSelection.group.id] = records;
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
