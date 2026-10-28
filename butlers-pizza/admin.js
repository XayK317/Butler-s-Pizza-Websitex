(() => {
    const accountKey = "butlersPizzaLocalDemoAccountV1";
    const sessionKey = "butlersPizzaLocalDemoSessionV1";
    const iterationCount = 210000;
    const pageNames = {
        "index.html": "Home",
        "about.html": "About / Media",
        "menu.html": "Menu",
        "specials.html": "Lunch Specials",
        "catering.html": "Catering",
        "faq.html": "FAQ's"
    };

    const authPanel = document.querySelector("#auth-panel");
    const setupForm = document.querySelector("#setup-form");
    const loginForm = document.querySelector("#login-form");
    const resetForm = document.querySelector("#reset-form");
    const editorShell = document.querySelector("#editor-shell");
    const loginMessage = document.querySelector("#login-message");
    const adminPrompt = document.querySelector("#admin-prompt");
    const resetMessage = document.querySelector("#reset-message");
    const preview = document.querySelector("#page-preview");
    const contentForm = document.querySelector("#content-form");
    const contentFields = document.querySelector("#content-fields");
    const pageSelect = document.querySelector("#page-select");
    const saveMessage = document.querySelector("#save-message");
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
        loadSelectedPage();
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

    const addLabel = (parent, title, control) => {
        const label = document.createElement("label");
        label.textContent = title;
        label.append(control);
        parent.append(label);
        return control;
    };

    const makeInput = (value, type = "text") => {
        const input = document.createElement("input");
        input.type = type;
        input.value = value || "";
        return input;
    };

    const makeTextarea = (value) => {
        const textarea = document.createElement("textarea");
        textarea.value = value || "";
        return textarea;
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

    const readListItem = (item) => ({
        title: item.querySelector(".item-text h3")?.textContent.trim() || "",
        description: Array.from(item.querySelectorAll(".item-text p"))
            .map((paragraph) => paragraph.textContent.trim())
            .filter(Boolean)
            .join("\n"),
        price: item.querySelector(".item-price")?.textContent.trim() || ""
    });

    const renderMenuRecord = (record, index, list) => {
        const fieldset = document.createElement("fieldset");
        fieldset.className = "menu-record";
        const legend = document.createElement("legend");
        legend.textContent = `Item ${index + 1}`;
        fieldset.append(legend);

        addLabel(fieldset, "Item title", makeInput(record.title));
        addLabel(fieldset, "Description", makeTextarea(record.description));
        addLabel(fieldset, "Price (optional)", makeInput(record.price));

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-record";
        removeButton.textContent = "Remove item";
        removeButton.addEventListener("click", () => {
            if (list.querySelectorAll(".menu-record").length <= 1) {
                showMessage(saveMessage, "Keep at least one item in each list.");
                return;
            }
            fieldset.remove();
        });
        fieldset.append(removeButton);
        list.append(fieldset);
    };

    const renderEditor = () => {
        const doc = preview.contentDocument;
        const pageApi = preview.contentWindow.ButlersAdminContent;
        if (!doc || !pageApi) {
            showMessage(saveMessage, "The preview did not load the content editor helper.");
            return;
        }
        const pageKey = pageApi.pageKey(doc);
        const content = pageApi.readOverrides();
        const pageContent = content[pageKey] || { fields: {}, lists: {} };
        contentFields.replaceChildren();

        const managedGroups = contentApi.getManagedGroups(doc);
        if (managedGroups.length) {
            managedGroups.forEach(({ id, node, label }) => {
                const group = document.createElement("details");
                const summary = document.createElement("summary");
                summary.textContent = label;
                group.append(summary);
                const list = document.createElement("div");
                list.className = "field-body";
                list.dataset.listId = id;
                const records = pageContent.lists?.[id]
                    || Array.from(node.querySelectorAll(":scope > .menu-item")).map(readListItem);
                records.forEach((record, index) => renderMenuRecord(record, index, list));

                const addButton = document.createElement("button");
                addButton.type = "button";
                addButton.className = "add-record";
                addButton.textContent = "Add item";
                addButton.addEventListener("click", () => {
                    renderMenuRecord({ title: "", description: "", price: "" }, list.children.length, list);
                });
                list.append(addButton);
                group.append(list);
                contentFields.append(group);
            });
        } else {
            const emptyMessage = document.createElement("p");
            emptyMessage.textContent = "This page has no menu-item lists. Click the preview to edit its text, images, and links.";
            contentFields.append(emptyMessage);
        }
        saveMessage.textContent = `Editing ${pageNames[pageKey] || pageKey}.`;
        selectionTitle.textContent = "Edit the page";
        selectionHint.textContent = "Click a heading or paragraph in the preview to edit it in place. Select an image to replace it, or click a menu item to edit its details.";
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
        selectionHint.textContent = "Edit this item's title, description, or price here. Add or remove rows under Manage menu items and specials.";
        selectionMessage.textContent = "";
        imageTools.hidden = true;
        linkTools.hidden = true;
        itemTools.hidden = false;
        document.querySelector("#item-title").value = item.querySelector(".item-text h3")?.textContent.trim() || "";
        document.querySelector("#item-description").value = Array.from(item.querySelectorAll(".item-text p"))
            .map((paragraph) => paragraph.textContent.trim())
            .join("\n");
        document.querySelector("#item-price").value = item.querySelector(".item-price")?.textContent.trim() || "";
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
        const style = doc.createElement("style");
        style.textContent = ".admin-edit-selected{outline:3px solid #d13014!important;outline-offset:3px;cursor:text}.admin-edit-selected img{outline:3px solid #d13014!important;outline-offset:3px}";
        doc.head.append(style);

        doc.addEventListener("click", (event) => {
            const target = event.target?.nodeType === 1 ? event.target : null;
            if (!target) {
                return;
            }
            const menuItem = target.closest(".menu-item");
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
        saveMessage.textContent = "Loading page preview…";
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
            const groupItems = Array.from(activeSelection.group.node.querySelectorAll(":scope > .menu-item"));
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
        contentForm.addEventListener("submit", (event) => {
            event.preventDefault();
            const doc = preview.contentDocument;
            const contentApi = preview.contentWindow.ButlersAdminContent;
            if (!doc || !contentApi) {
                showMessage(saveMessage, "The page preview is unavailable. Reload the selected page and try again.");
                return;
            }
            const pageKey = contentApi.pageKey(doc);
            let content;
            try {
                content = contentApi.readOverrides();
            } catch (error) {
                console.error("Could not read locally saved site content.", error);
                showMessage(saveMessage, "Saved content could not be read. Browser storage may be unavailable.");
                return;
            }
            const pageContent = currentPageContent(content, pageKey);

            for (const control of contentFields.querySelectorAll("[data-field-id]")) {
                const { fieldId, property } = control.dataset;
                if (property === "src" || property === "href") {
                    const checkedUrl = contentApi.safeUrl(control.value, doc.baseURI);
                    if (checkedUrl === null || (property === "src" && !control.value.trim())) {
                        control.setCustomValidity("Enter a valid http(s) URL or a relative site path.");
                        control.reportValidity();
                        control.setCustomValidity("");
                        return;
                    }
                }
                if (!pageContent.fields[fieldId]) {
                    pageContent.fields[fieldId] = {};
                }
                pageContent.fields[fieldId][property] = control.value;
            }

            let hasInvalidTitle = false;
            contentFields.querySelectorAll("[data-list-id]").forEach((list) => {
                const records = Array.from(list.querySelectorAll(".menu-record")).map((record) => ({
                    title: record.querySelector("input")?.value.trim() || "",
                    description: record.querySelector("textarea")?.value.trim() || "",
                    price: record.querySelectorAll("input")[1]?.value.trim() || ""
                }));
                if (records.some((record) => !record.title)) {
                    showMessage(saveMessage, "Every menu item needs a title.");
                    hasInvalidTitle = true;
                    return;
                }
                pageContent.lists[list.dataset.listId] = records;
            });
            if (hasInvalidTitle) {
                return;
            }

            try {
                localStorage.setItem(contentApi.storageKey, JSON.stringify(content));
            } catch (error) {
                console.error("Could not save local site content.", error);
                showMessage(saveMessage, "Could not save changes. Browser storage may be full or unavailable.");
                return;
            }
            saveMessage.textContent = "Saved in this browser. Reload the preview to see the saved changes.";
            loadSelectedPage();
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

    document.querySelector("#logout-button").addEventListener("click", () => {
        sessionStorage.removeItem(sessionKey);
        location.href = "admin.html";
    });

    initEditor();
    initialize();
})();
