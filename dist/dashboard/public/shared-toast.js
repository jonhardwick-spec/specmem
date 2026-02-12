/**
 * SPECMEM Toast Notification System
 * Displays non-intrusive notifications
 */

class SpecMemToast {
    constructor(options = {}) {
        this.container = null;
        this.position = options.position || 'top-right'; // top-right, top-left, bottom-right, bottom-left
        this.maxToasts = options.maxToasts || 5;
        this.defaultDuration = options.defaultDuration || 4000;
        this.init();
    }

    init() {
        this.injectStyles();
        this.createContainer();
    }

    createContainer() {
        this.container = document.createElement('div');
        this.container.className = `toast-container toast-${this.position}`;
        this.container.setAttribute('role', 'region');
        this.container.setAttribute('aria-label', 'Notifications');
        document.body.appendChild(this.container);
    }

    show(message, options = {}) {
        const type = options.type || 'info'; // success, error, warning, info
        const duration = options.duration !== undefined ? options.duration : this.defaultDuration;
        const title = options.title || null;
        const icon = options.icon || this.getDefaultIcon(type);

        const toast = this.createToast(message, type, title, icon);

        // Limit number of toasts
        if (this.container.children.length >= this.maxToasts) {
            this.container.removeChild(this.container.firstChild);
        }

        this.container.appendChild(toast);

        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => this.dismiss(toast), duration);
        }

        // Return toast element for manual control
        return toast;
    }

    createToast(message, type, title, icon) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');

        // Icon
        const iconEl = document.createElement('div');
        iconEl.className = 'toast-icon';
        iconEl.textContent = icon;
        iconEl.setAttribute('aria-hidden', 'true');

        // Content
        const content = document.createElement('div');
        content.className = 'toast-content';

        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'toast-title';
            titleEl.textContent = title;
            content.appendChild(titleEl);
        }

        const messageEl = document.createElement('div');
        messageEl.className = 'toast-message';
        messageEl.textContent = message;
        content.appendChild(messageEl);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.onclick = () => this.dismiss(toast);

        toast.appendChild(iconEl);
        toast.appendChild(content);
        toast.appendChild(closeBtn);

        return toast;
    }

    dismiss(toast) {
        if (!toast || !toast.parentElement) return;

        toast.classList.add('toast-hide');

        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300);
    }

    getDefaultIcon(type) {
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        return icons[type] || icons.info;
    }

    // Convenience methods
    success(message, options = {}) {
        return this.show(message, { ...options, type: 'success' });
    }

    error(message, options = {}) {
        return this.show(message, { ...options, type: 'error' });
    }

    warning(message, options = {}) {
        return this.show(message, { ...options, type: 'warning' });
    }

    info(message, options = {}) {
        return this.show(message, { ...options, type: 'info' });
    }

    clear() {
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
    }

    destroy() {
        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }

    injectStyles() {
        const styleId = 'specmem-toast-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .toast-container {
                position: fixed;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 20px;
                pointer-events: none;
            }

            .toast-container.toast-top-right {
                top: 0;
                right: 0;
            }

            .toast-container.toast-top-left {
                top: 0;
                left: 0;
            }

            .toast-container.toast-bottom-right {
                bottom: 0;
                right: 0;
            }

            .toast-container.toast-bottom-left {
                bottom: 0;
                left: 0;
            }

            .toast {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                min-width: 300px;
                max-width: 500px;
                padding: 16px;
                background: var(--csgo-gray-light, #2a2a2a);
                border-left: 4px solid var(--csgo-yellow, #FFD700);
                border-radius: var(--radius-md, 6px);
                box-shadow:
                    0 8px 16px rgba(0, 0, 0, 0.5),
                    0 0 20px rgba(0, 0, 0, 0.3);
                pointer-events: auto;
                animation: toastSlideIn 0.3s ease-out;
                transition: all 0.3s ease;
            }

            .toast-success {
                border-left-color: var(--csgo-success, #4CAF50);
            }

            .toast-error {
                border-left-color: var(--csgo-error, #f44336);
            }

            .toast-warning {
                border-left-color: var(--csgo-warning, #ff9800);
            }

            .toast-info {
                border-left-color: var(--csgo-yellow, #FFD700);
            }

            .toast-icon {
                font-size: 24px;
                font-weight: bold;
                flex-shrink: 0;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.1);
            }

            .toast-success .toast-icon {
                color: var(--csgo-success, #4CAF50);
                background: rgba(76, 175, 80, 0.2);
            }

            .toast-error .toast-icon {
                color: var(--csgo-error, #f44336);
                background: rgba(244, 67, 54, 0.2);
            }

            .toast-warning .toast-icon {
                color: var(--csgo-warning, #ff9800);
                background: rgba(255, 152, 0, 0.2);
            }

            .toast-info .toast-icon {
                color: var(--csgo-yellow, #FFD700);
                background: rgba(255, 215, 0, 0.2);
            }

            .toast-content {
                flex: 1;
                min-width: 0;
            }

            .toast-title {
                font-family: 'Orbitron', monospace;
                font-size: 14px;
                font-weight: 600;
                color: var(--csgo-text, #e0e0e0);
                margin-bottom: 4px;
            }

            .toast-message {
                font-size: 13px;
                color: var(--csgo-text-dim, #888);
                line-height: 1.5;
                word-wrap: break-word;
            }

            .toast-close {
                flex-shrink: 0;
                background: none;
                border: none;
                color: var(--csgo-text-dim, #888);
                font-size: 24px;
                line-height: 1;
                cursor: pointer;
                padding: 0;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.2s ease;
            }

            .toast-close:hover {
                background: rgba(255, 255, 255, 0.1);
                color: var(--csgo-text, #e0e0e0);
            }

            .toast-close:focus-visible {
                outline: 2px solid var(--csgo-yellow, #FFD700);
                outline-offset: 2px;
            }

            @keyframes toastSlideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            .toast-container.toast-top-left .toast,
            .toast-container.toast-bottom-left .toast {
                animation: toastSlideInLeft 0.3s ease-out;
            }

            @keyframes toastSlideInLeft {
                from {
                    transform: translateX(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            .toast.toast-hide {
                animation: toastSlideOut 0.3s ease-out forwards;
            }

            @keyframes toastSlideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }

            .toast-container.toast-top-left .toast.toast-hide,
            .toast-container.toast-bottom-left .toast.toast-hide {
                animation: toastSlideOutLeft 0.3s ease-out forwards;
            }

            @keyframes toastSlideOutLeft {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(-100%);
                    opacity: 0;
                }
            }

            /* Mobile responsive */
            @media (max-width: 480px) {
                .toast-container {
                    padding: 10px;
                    left: 0 !important;
                    right: 0 !important;
                }

                .toast {
                    min-width: auto;
                    max-width: none;
                    margin: 0 auto;
                }

                .toast-icon {
                    font-size: 20px;
                    width: 24px;
                    height: 24px;
                }

                .toast-title {
                    font-size: 13px;
                }

                .toast-message {
                    font-size: 12px;
                }
            }

            /* Reduced motion */
            @media (prefers-reduced-motion: reduce) {
                .toast {
                    animation: none !important;
                }
            }
        `;

        document.head.appendChild(style);
    }
}

// Create global instance
let specmemToast;

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!specmemToast) {
            specmemToast = new SpecMemToast();
        }
    });
} else {
    if (!specmemToast) {
        specmemToast = new SpecMemToast();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpecMemToast;
}
