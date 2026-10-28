(() => {
    const storageKey = "butlersPizzaAdminContentV1";

    const readOverrides = () => {
        const storedContent = localStorage.getItem(storageKey);
        return storedContent ? JSON.parse(storedContent) : {};
    };

    const pageKey = (doc = document) => {
        const currentPath = new URL(doc.location.href).pathname;
        return currentPath.substring(currentPath.lastIndexOf("/") + 1) || "index.html";
    };

    const getEditableFields = (doc = document) => {
        const fieldNodes = Array.from(doc.querySelectorAll(
            "main h1, main h2, main h3, main h4, main p, footer h2, footer h4, footer p, .media-cta, .amp-link, .map-directions"
        )).filter((node) => !node.closest(".menu-item"));
        const tagIndexes = new Map();
        const fields = fieldNodes.map((node) => {
            const tagName = node.tagName.toLowerCase();
            const index = tagIndexes.get(tagName) || 0;
            tagIndexes.set(tagName, index + 1);
            return {
                id: `text-${tagName}-${index}`,
                kind: "text",
                node,
                label: `${tagName.toUpperCase()} ${index + 1}: ${node.textContent.trim().slice(0, 60)}`
            };
        });

        Array.from(doc.querySelectorAll("main img")).forEach((node, index) => {
            fields.push({
                id: `image-${index}`,
                kind: "image",
                node,
                label: `Image ${index + 1}: ${node.alt || node.getAttribute("src") || "No description"}`
            });
        });

        Array.from(doc.querySelectorAll(".media-cta, .footer-interactive a")).forEach((node, index) => {
            fields.push({
                id: `link-${index}`,
                kind: "link",
                node,
                label: `Link ${index + 1}: ${node.getAttribute("aria-label") || node.textContent.trim().slice(0, 50)}`
            });
        });

        return fields;
    };

    const getManagedGroups = (doc = document) => {
        const groupSelectors = [
            "#menu > .menu-columns > .menu-column",
            "main.menu-page-content > .menu-columns > .menu-column",
            ".coupon-section .menu-columns > .menu-column",
            ".menu-category-items"
        ];
        const groups = [];
        groupSelectors.forEach((selector) => {
            doc.querySelectorAll(selector).forEach((node) => {
                if (!node.querySelector(".menu-item")) {
                    return;
                }
                let id = `${selector.replace(/[^a-z0-9]+/gi, "-")}-${groups.length}`;
                const category = node.closest(".menu-category");
                if (category?.id) {
                    id = `category-${category.id}`;
                } else if (node.closest(".coupon-section")) {
                    id = `coupon-${Array.from(doc.querySelectorAll(".coupon-section .menu-columns > .menu-column")).indexOf(node)}`;
                } else if (node.closest("#menu")) {
                    id = `home-lunch-${Array.from(doc.querySelectorAll("#menu > .menu-columns > .menu-column")).indexOf(node)}`;
                } else if (node.closest("main.menu-page-content")) {
                    id = `special-lunch-${Array.from(doc.querySelectorAll("main.menu-page-content > .menu-columns > .menu-column")).indexOf(node)}`;
                }
                groups.push({
                    id,
                    node,
                    label: category?.querySelector("h2")?.textContent.trim()
                        || (node.closest(".coupon-section") ? `Coupons ${groups.length + 1}` : `Lunch specials ${groups.length + 1}`)
                });
            });
        });
        return groups;
    };

    const safeUrl = (value, baseUri) => {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return "";
        }
        if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmedValue)
            && trimmedValue.length <= 1_500_000) {
            return trimmedValue;
        }
        try {
            const parsedUrl = new URL(trimmedValue, baseUri);
            return ["http:", "https:"].includes(parsedUrl.protocol) ? trimmedValue : null;
        } catch {
            return null;
        }
    };

    const setPlainText = (node, value) => {
        const ownerDocument = node.ownerDocument;
        node.replaceChildren();
        value.split(/\r?\n/).forEach((line, index) => {
            if (index > 0) {
                node.append(ownerDocument.createElement("br"));
            }
            node.append(ownerDocument.createTextNode(line));
        });
    };

    const setMenuItem = (item, record) => {
        const title = item.querySelector(".item-text h3");
        const textContainer = item.querySelector(".item-text");
        if (title) {
            setPlainText(title, record.title || "");
        }
        if (textContainer) {
            const descriptions = Array.from(textContainer.querySelectorAll("p"));
            if (record.description) {
                const description = descriptions.shift() || document.createElement("p");
                setPlainText(description, record.description);
                if (!description.parentElement) {
                    textContainer.append(description);
                }
            }
            descriptions.forEach((description) => description.remove());
        }

        let price = item.querySelector(".item-price");
        if (record.price) {
            if (!price) {
                price = document.createElement("span");
                price.className = "item-price";
                item.append(price);
            }
            price.textContent = record.price;
        } else {
            price?.remove();
        }
    };

    const applyOverrides = (doc = document) => {
        let content;
        try {
            content = readOverrides();
        } catch (error) {
            console.error("Could not read locally saved site content.", error);
            return;
        }
        const pageContent = content[pageKey(doc)];
        if (!pageContent) {
            return;
        }

        getEditableFields(doc).forEach(({ id, kind, node }) => {
            const changes = pageContent.fields?.[id];
            if (!changes) {
                return;
            }
            if (kind === "text" && typeof changes.text === "string") {
                setPlainText(node, changes.text);
            } else if (kind === "image") {
                if (typeof changes.src === "string") {
                    const source = safeUrl(changes.src, doc.baseURI);
                    if (source !== null) {
                        node.setAttribute("src", source);
                    }
                }
                if (typeof changes.alt === "string") {
                    node.setAttribute("alt", changes.alt);
                }
            } else if (kind === "link") {
                if (typeof changes.text === "string") {
                    node.textContent = changes.text;
                }
                if (typeof changes.href === "string") {
                    const href = safeUrl(changes.href, doc.baseURI);
                    if (href !== null) {
                        node.setAttribute("href", href);
                    }
                }
            }
        });

        const template = doc.querySelector(".menu-item");
        if (!template) {
            return;
        }
        getManagedGroups(doc).forEach(({ id, node }) => {
            const records = pageContent.lists?.[id];
            if (!Array.isArray(records)) {
                return;
            }
            const originalItems = Array.from(node.querySelectorAll(":scope > .menu-item"));
            const rowTemplate = originalItems[0] || doc.createElement("article");
            let insertionMarker = null;
            if (!rowTemplate.matches(".menu-item")) {
                rowTemplate.className = "menu-item";
                rowTemplate.innerHTML = '<div class="item-text"><h3></h3></div>';
            }
            if (originalItems.length === 0 && records.length === 0) {
                return;
            }
            if (originalItems[0]) {
                insertionMarker = doc.createComment("");
                node.insertBefore(insertionMarker, originalItems[0]);
            }
            originalItems.forEach((item) => item.remove());
            records.forEach((record) => {
                if (!record || typeof record !== "object") {
                    return;
                }
                const newItem = rowTemplate.cloneNode(true);
                setMenuItem(newItem, record);
                if (insertionMarker) {
                    node.insertBefore(newItem, insertionMarker);
                } else {
                    node.append(newItem);
                }
            });
            insertionMarker?.remove();
        });
    };

    window.ButlersAdminContent = {
        storageKey,
        readOverrides,
        pageKey,
        getEditableFields,
        getManagedGroups,
        setMenuItem,
        setPlainText,
        safeUrl,
        applyOverrides
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => applyOverrides(), { once: true });
    } else {
        applyOverrides();
    }
})();
