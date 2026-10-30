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

    const getPosterGroups = (doc = document) => {
        const specs = [
            [".sig .cols", ":scope > .item"],
            [".lunch .cols > div", ":scope > .item"],
            [".sand .cols > div", ":scope > .item"],
            [".sig .grid", ":scope > .row:not(.head)"],
            [".sand .lower > div", ":scope > .line"]
        ];
        const groups = [];
        specs.forEach(([selector, itemSelector]) => {
            doc.querySelectorAll(selector).forEach((node) => {
                groups.push({ id: `poster-${groups.length}`, node, itemSelector, kind: "poster" });
            });
        });
        return groups;
    };

    const readPosterRow = (item) => {
        const clone = item.cloneNode(true);
        clone.querySelectorAll(".admin-control").forEach((control) => control.remove());
        [clone, ...clone.querySelectorAll("*")].forEach((node) => {
            node.classList.remove("admin-edit-selected", "admin-has-controls");
            node.removeAttribute("contenteditable");
            node.removeAttribute("data-admin-editing");
            if (!node.getAttribute("class")) {
                node.removeAttribute("class");
            }
        });
        return clone.outerHTML;
    };

    const parsePosterRow = (doc, html) => {
        const template = doc.createElement("template");
        template.innerHTML = html;
        template.content.querySelectorAll("script, iframe, object, embed, link, style").forEach((node) => node.remove());
        template.content.querySelectorAll("*").forEach((node) => {
            Array.from(node.attributes).forEach((attribute) => {
                if (/^on/i.test(attribute.name)) {
                    node.removeAttribute(attribute.name);
                }
            });
        });
        return template.content.firstElementChild;
    };

    const createPosterRow = (doc, group) => {
        const items = Array.from(group.node.querySelectorAll(group.itemSelector));
        const template = items.reduce((best, item) => (
            item.querySelectorAll("p, h3").length >= best.querySelectorAll("p, h3").length ? item : best
        ), items[0]);
        const item = parsePosterRow(doc, readPosterRow(template));
        item.classList.remove("center");
        if (item.matches(".item")) {
            item.querySelectorAll("h3").forEach((node) => setPlainText(node, "New Item"));
            item.querySelectorAll("p").forEach((node) => {
                setPlainText(node, node.classList.contains("price") ? "$0.00" : "Describe this item.");
            });
        } else {
            item.querySelectorAll("p").forEach((node, index) => setPlainText(node, index === 0 ? "New Item" : "$0.00"));
        }
        return item;
    };

    const getEditableFields = (doc = document) => {
        const fieldNodes = Array.from(doc.querySelectorAll(
            "main h1, main h2, main h3, main h4, main p, footer h2, footer h4, footer p, .media-cta, .amp-link, .map-directions"
        )).filter((node) => !node.closest(".menu-item"));
        const tagIndexes = new Map();
        const posterGroups = getPosterGroups(doc);
        const posterCounts = new Map();
        const fields = fieldNodes.map((node) => {
            const tagName = node.tagName.toLowerCase();
            // Poster rows are saved as a whole, so their text gets ids that never shift other fields.
            const posterGroup = posterGroups.find((group) => (
                Array.from(group.node.querySelectorAll(group.itemSelector)).some((item) => item.contains(node))
            ));
            if (posterGroup) {
                const count = posterCounts.get(posterGroup.id) || 0;
                posterCounts.set(posterGroup.id, count + 1);
                return {
                    id: `${posterGroup.id}-text-${count}`,
                    kind: "text",
                    node,
                    posterGroup,
                    label: `${tagName.toUpperCase()}: ${node.textContent.trim().slice(0, 60)}`
                };
            }
            const index = tagIndexes.get(tagName) || 0;
            tagIndexes.set(tagName, index + 1);
            return {
                id: `text-${tagName}-${index}`,
                kind: "text",
                node,
                label: `${tagName.toUpperCase()} ${index + 1}: ${node.textContent.trim().slice(0, 60)}`
            };
        });

        let imageIndex = 0;
        const galleryStates = new Map();
        Array.from(doc.querySelectorAll("main img")).forEach((node) => {
            const gallery = node.closest("[data-carousel], .media-gallery-collage");
            let fieldIndex = imageIndex;
            if (gallery) {
                // Gallery photos keep their original ids so added or removed photos never renumber later images.
                let state = galleryStates.get(gallery);
                if (!state) {
                    state = {
                        base: imageIndex,
                        seen: 0,
                        original: Number(gallery.dataset.adminOriginalCount) || gallery.querySelectorAll("img").length
                    };
                    galleryStates.set(gallery, state);
                    imageIndex += state.original;
                }
                fieldIndex = state.base + state.seen;
                state.seen += 1;
                if (state.seen > state.original) {
                    return;
                }
            } else {
                imageIndex += 1;
            }
            fields.push({
                id: `image-${fieldIndex}`,
                kind: "image",
                node,
                label: `Image ${fieldIndex + 1}: ${node.alt || node.getAttribute("src") || "No description"}`
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
            ".menu-category-items",
            ".discount-section > ul"
        ];
        const groups = [];
        groupSelectors.forEach((selector) => {
            doc.querySelectorAll(selector).forEach((node) => {
                const isDiscount = node.matches(".discount-section > ul");
                let id = `${selector.replace(/[^a-z0-9]+/gi, "-")}-${groups.length}`;
                const category = node.closest(".menu-category");
                if (isDiscount) {
                    id = `discount-${Array.from(doc.querySelectorAll(".discount-section > ul")).indexOf(node)}`;
                } else if (category?.id) {
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
                    itemSelector: isDiscount ? ":scope > li:not(.admin-control)" : ":scope > .menu-item",
                    kind: isDiscount ? "discount" : (node.closest(".coupon-section") ? "coupon" : "menu"),
                    label: category?.querySelector("h2")?.textContent.trim()
                        || (isDiscount ? "Discounts" : (node.closest(".coupon-section") ? `Coupons ${groups.length + 1}` : `Lunch specials ${groups.length + 1}`))
                });
            });
        });
        return groups;
    };

    const getGalleryGroups = (doc = document) => {
        const groups = [];
        doc.querySelectorAll("[data-carousel]").forEach((node, index) => {
            groups.push({
                id: `carousel-${index}`,
                kind: "carousel",
                node,
                itemSelector: ":scope > .carousel-slide",
                minimum: 3
            });
        });
        doc.querySelectorAll(".media-gallery-collage").forEach((node, index) => {
            groups.push({
                id: `collage-${index}`,
                kind: "collage",
                node,
                itemSelector: ":scope > .media-gallery-item",
                minimum: Number(node.dataset.adminOriginalCount) || node.querySelectorAll(":scope > .media-gallery-item").length
            });
        });
        return groups;
    };

    const markGalleryOriginals = (doc = document) => {
        getGalleryGroups(doc).forEach(({ node, itemSelector }) => {
            if (!node.dataset.adminOriginalCount) {
                node.dataset.adminOriginalCount = String(node.querySelectorAll(itemSelector).length);
            }
        });
    };

    const galleryImage = (item) => (item.matches("img") ? item : item.querySelector("img"));

    const clampNumber = (value, min, max, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };

    const readCrop = (img) => ({
        x: clampNumber(img.dataset.cropX, 0, 100, 50),
        y: clampNumber(img.dataset.cropY, 0, 100, 50),
        zoom: clampNumber(img.dataset.cropZoom, 100, 300, 100)
    });

    const applyCrop = (img, crop) => {
        const x = clampNumber(crop?.x, 0, 100, 50);
        const y = clampNumber(crop?.y, 0, 100, 50);
        const zoom = clampNumber(crop?.zoom, 100, 300, 100);
        if (x === 50 && y === 50 && zoom === 100) {
            ["object-position", "transform-origin", "transform"].forEach((property) => img.style.removeProperty(property));
            delete img.dataset.cropX;
            delete img.dataset.cropY;
            delete img.dataset.cropZoom;
            return;
        }
        img.style.objectPosition = `${x}% ${y}%`;
        img.style.transformOrigin = `${x}% ${y}%`;
        img.style.transform = zoom > 100 ? `scale(${zoom / 100})` : "";
        img.dataset.cropX = String(x);
        img.dataset.cropY = String(y);
        img.dataset.cropZoom = String(zoom);
    };

    const readGalleryRecord = (item) => {
        const img = galleryImage(item);
        return {
            src: img.getAttribute("src") || "",
            alt: img.getAttribute("alt") || "",
            ...readCrop(img)
        };
    };

    const setGalleryRecord = (item, record, baseUri) => {
        const img = galleryImage(item);
        if (typeof record.src === "string") {
            const source = safeUrl(record.src, baseUri);
            if (source) {
                img.setAttribute("src", source);
            }
        }
        if (typeof record.alt === "string") {
            img.setAttribute("alt", record.alt);
        }
        applyCrop(img, record);
    };

    const createGalleryItem = (doc, group, record) => {
        const img = doc.createElement("img");
        let item = img;
        if (group.kind === "carousel") {
            img.className = "carousel-slide";
            img.hidden = true;
            img.setAttribute("aria-hidden", "true");
        } else {
            item = doc.createElement("div");
            item.className = "media-gallery-item";
            item.append(img);
        }
        setGalleryRecord(item, record, doc.baseURI);
        return item;
    };

    const syncCarouselIndicators = (node, preferredIndex) => {
        const doc = node.ownerDocument;
        const container = node.querySelector(".carousel-indicators");
        const slides = Array.from(node.querySelectorAll(":scope > .carousel-slide"));
        if (!container || slides.length === 0) {
            return;
        }
        let activeIndex = Number.isInteger(preferredIndex) ? preferredIndex : slides.findIndex((slide) => !slide.hidden);
        activeIndex = Math.min(slides.length - 1, Math.max(0, activeIndex));
        slides.forEach((slide, index) => {
            slide.hidden = index !== activeIndex;
            slide.setAttribute("aria-hidden", String(index !== activeIndex));
        });
        container.replaceChildren(...slides.map((slide, index) => {
            const indicator = doc.createElement("button");
            indicator.type = "button";
            indicator.className = index === activeIndex ? "carousel-indicator is-active" : "carousel-indicator";
            indicator.dataset.carouselSlide = String(index);
            indicator.setAttribute("aria-label", `Show photo ${index + 1}`);
            if (index === activeIndex) {
                indicator.setAttribute("aria-current", "true");
            }
            return indicator;
        }));
        node.dispatchEvent(new doc.defaultView.CustomEvent("carousel:refresh", { detail: { index: activeIndex } }));
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
        if (item.matches("li")) {
            let label = item.querySelector("span");
            let value = item.querySelector("strong");
            if (!label) {
                label = item.ownerDocument.createElement("span");
                item.prepend(label);
            }
            if (!value) {
                value = item.ownerDocument.createElement("strong");
                item.append(value);
            }
            setPlainText(label, record.title || "");
            value.textContent = record.price || "";
            return;
        }
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

    const createGroupItem = (doc, group, record) => {
        const existingItem = group.node.querySelector(group.itemSelector);
        let item;
        if (existingItem) {
            item = existingItem.cloneNode(true);
            item.querySelectorAll(".admin-control").forEach((control) => control.remove());
            item.classList.remove("admin-edit-selected");
            item.removeAttribute("contenteditable");
        } else if (group.kind === "discount") {
            item = doc.createElement("li");
        } else {
            item = doc.createElement("article");
            item.className = "menu-item";
            item.innerHTML = '<div class="item-text"><h3></h3></div>';
        }
        setMenuItem(item, record);
        return item;
    };

    const readMenuRecord = (item) => {
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

    // Lunch specials appear on the home, specials and menu pages; they share one stored list.
    const sharedKeyOf = (group) => (
        group.id === "category-lunch-specials" || /^(home|special)-lunch-\d+$/.test(group.id) ? "lunch" : null
    );

    const saveGroupRecords = (content, pageKey, doc, group, records) => {
        const key = sharedKeyOf(group);
        if (!key) {
            content[pageKey] = content[pageKey] || {};
            content[pageKey].lists = content[pageKey].lists || {};
            content[pageKey].lists[group.id] = records;
            return;
        }
        const siblings = getManagedGroups(doc).filter((other) => sharedKeyOf(other) === key);
        const columns = siblings.map((other) => (
            other === group ? records : Array.from(other.node.querySelectorAll(other.itemSelector)).map(readMenuRecord)
        ));
        const all = columns.flat();
        content.__shared = content.__shared || {};
        content.__shared[key] = {
            records: all,
            split: siblings.length > 1 ? columns[0].length : Math.ceil(all.length / 2)
        };
    };

    const applyOverrides = (doc = document) => {
        markGalleryOriginals(doc);
        let content;
        try {
            content = readOverrides();
        } catch (error) {
            console.error("Could not read locally saved site content.", error);
            return;
        }
        const pageContent = content[pageKey(doc)] || {};

        getPosterGroups(doc).forEach((group) => {
            const rows = pageContent.posterRows?.[group.id];
            if (!Array.isArray(rows)) {
                return;
            }
            const items = Array.from(group.node.querySelectorAll(group.itemSelector));
            const marker = doc.createComment("");
            group.node.insertBefore(marker, items[0] || null);
            items.forEach((item) => item.remove());
            rows.forEach((html) => {
                const row = typeof html === "string" ? parsePosterRow(doc, html) : null;
                if (row) {
                    group.node.insertBefore(row, marker);
                }
            });
            marker.remove();
        });

        getEditableFields(doc).forEach(({ id, kind, node, posterGroup }) => {
            const changes = pageContent.fields?.[id];
            if (!changes || posterGroup) {
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
                if (node.closest(".about-team-photo, .poster-art") && changes.zoom !== undefined) {
                    applyCrop(node, changes);
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

        const managedGroups = getManagedGroups(doc);
        managedGroups.forEach((group) => {
            const { id, node } = group;
            let records = pageContent.lists?.[id];
            const sharedKey = sharedKeyOf(group);
            const shared = sharedKey ? content.__shared?.[sharedKey] : null;
            if (shared && Array.isArray(shared.records)) {
                const siblings = managedGroups.filter((other) => sharedKeyOf(other) === sharedKey);
                const position = siblings.indexOf(group);
                records = siblings.length < 2
                    ? shared.records
                    : (position === 0 ? shared.records.slice(0, shared.split) : (position === 1 ? shared.records.slice(shared.split) : []));
            }
            if (!Array.isArray(records)) {
                return;
            }
            const originalItems = Array.from(node.querySelectorAll(group.itemSelector));
            const firstTitle = originalItems[0]?.querySelector(".item-text h3")?.textContent || "";
            const upperCase = shared && firstTitle && firstTitle === firstTitle.toUpperCase();
            if (upperCase) {
                records = records.map((record) => ({
                    ...record,
                    title: String(record.title || "").toUpperCase(),
                    description: String(record.description || "").toUpperCase()
                }));
            }
            let insertionMarker = null;
            if (originalItems.length === 0 && records.length === 0) {
                return;
            }
            const rowTemplate = createGroupItem(doc, group, {});
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

        getGalleryGroups(doc).forEach((group) => {
            const records = pageContent.galleries?.[group.id];
            if (!Array.isArray(records)) {
                return;
            }
            const validRecords = records.filter((record) => record && typeof record === "object");
            if (validRecords.length < group.minimum) {
                return;
            }
            const items = Array.from(group.node.querySelectorAll(group.itemSelector));
            items.splice(validRecords.length).forEach((item) => item.remove());
            validRecords.forEach((record, index) => {
                if (items[index]) {
                    setGalleryRecord(items[index], record, doc.baseURI);
                    return;
                }
                const newItem = createGalleryItem(doc, group, record);
                const controls = group.node.querySelector(":scope > .carousel-controls");
                if (controls) {
                    group.node.insertBefore(newItem, controls);
                } else {
                    group.node.append(newItem);
                }
            });
            if (group.kind === "carousel") {
                syncCarouselIndicators(group.node, 0);
            }
        });
    };

    window.ButlersAdminContent = {
        getGalleryGroups,
        getPosterGroups,
        readPosterRow,
        createPosterRow,
        galleryImage,
        readCrop,
        applyCrop,
        readGalleryRecord,
        createGalleryItem,
        syncCarouselIndicators,
        storageKey,
        readOverrides,
        pageKey,
        getEditableFields,
        getManagedGroups,
        saveGroupRecords,
        readMenuRecord,
        createGroupItem,
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
