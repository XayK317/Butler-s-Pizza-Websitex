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

    const applyOverrides = (doc = document) => {
        markGalleryOriginals(doc);
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

        getManagedGroups(doc).forEach((group) => {
            const { id, node } = group;
            const records = pageContent.lists?.[id];
            if (!Array.isArray(records)) {
                return;
            }
            const originalItems = Array.from(node.querySelectorAll(group.itemSelector));
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
        setMenuItem,
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
