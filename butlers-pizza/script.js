document.addEventListener("DOMContentLoaded", () => {
    const footerStage = document.querySelector(".footer-reveal-stage");
    const footer = footerStage?.querySelector(".site-footer");
    const menu = document.querySelector("#menu");

    if (footerStage && footer && menu) {
        const updateFooterReveal = () => {
            const menuBottom = menu.getBoundingClientRect().bottom + window.scrollY;
            const footerTop = Math.max(0, window.innerHeight - footer.offsetHeight);
            const revealStart = Math.max(0, menuBottom - window.innerHeight);
            const revealEnd = Math.max(revealStart + 1, menuBottom - footerTop);
            const revealProgress = Math.max(
                0,
                Math.min(1, (window.scrollY - revealStart) / (revealEnd - revealStart))
            );
            footer.style.setProperty("--footer-reveal-clip", `${(1 - revealProgress) * 50}%`);
        };

        const updateFooterStageHeight = () => {
            footerStage.style.height = `${footer.offsetHeight}px`;
            updateFooterReveal();
        };
        updateFooterStageHeight();

        const resizeObserver = new ResizeObserver(updateFooterStageHeight);
        resizeObserver.observe(footer);
        window.addEventListener("scroll", updateFooterReveal, { passive: true });
        window.addEventListener("resize", updateFooterReveal);
    }

    document.querySelectorAll("[data-carousel]").forEach((carousel) => {
        const slides = Array.from(carousel.querySelectorAll(".carousel-slide"));
        const indicators = Array.from(carousel.querySelectorAll("[data-carousel-slide]"));

        if (slides.length === 0 || indicators.length !== slides.length) {
            return;
        }

        let activeIndex = slides.findIndex((slide) => !slide.hidden);
        if (activeIndex < 0) {
            activeIndex = 0;
        }

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let autoplayTimer;

        const scheduleNextSlide = () => {
            window.clearTimeout(autoplayTimer);
            if (
                !carousel.matches(":hover") &&
                !carousel.contains(document.activeElement) &&
                !reducedMotion.matches &&
                !document.hidden
            ) {
                autoplayTimer = window.setTimeout(() => {
                    showSlide(activeIndex + 1);
                }, 5000);
            }
        };

        const showSlide = (index) => {
            activeIndex = (index + slides.length) % slides.length;
            slides.forEach((slide, slideIndex) => {
                const isActive = slideIndex === activeIndex;
                slide.hidden = !isActive;
                slide.setAttribute("aria-hidden", String(!isActive));
                indicators[slideIndex].classList.toggle("is-active", isActive);
                if (isActive) {
                    indicators[slideIndex].setAttribute("aria-current", "true");
                } else {
                    indicators[slideIndex].removeAttribute("aria-current");
                }
            });
            scheduleNextSlide();
        };

        const pauseAutoplay = () => {
            window.clearTimeout(autoplayTimer);
        };

        const resumeAutoplay = () => {
            scheduleNextSlide();
        };

        carousel.querySelector("[data-carousel-previous]")?.addEventListener("click", () => {
            showSlide(activeIndex - 1);
        });

        carousel.querySelector("[data-carousel-next]")?.addEventListener("click", () => {
            showSlide(activeIndex + 1);
        });

        indicators.forEach((indicator, index) => {
            indicator.addEventListener("click", () => showSlide(index));
        });

        carousel.addEventListener("pointerenter", pauseAutoplay);
        carousel.addEventListener("pointerleave", resumeAutoplay);
        carousel.addEventListener("focusin", pauseAutoplay);
        carousel.addEventListener("focusout", (event) => {
            if (!carousel.contains(event.relatedTarget)) {
                resumeAutoplay();
            }
        });
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                window.clearTimeout(autoplayTimer);
            } else {
                scheduleNextSlide();
            }
        });
        reducedMotion.addEventListener("change", scheduleNextSlide);

        showSlide(activeIndex);
    });
});
