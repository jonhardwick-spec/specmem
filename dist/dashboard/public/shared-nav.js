/**
 * SPECMEM Shared Navigation Component
 * Provides consistent navigation across all dashboard pages
 */

class SpecMemNavigation {
    constructor(options = {}) {
        this.currentPage = options.currentPage || this.detectCurrentPage();
        this.navItems = options.navItems || this.getDefaultNavItems();
        this.containerId = options.containerId || 'specmem-nav';
        this.init();
    }

    detectCurrentPage() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'index.html';
        return filename.replace('.html', '');
    }

    getDefaultNavItems() {
        return [
            {
                id: 'index',
                label: 'Dashboard',
                shortLabel: 'Stats',
                icon: '📊',
                href: '/index.html',
                section: 'stats',
                description: 'Memory statistics and overview'
            },
            {
                id: 'team-members',
                label: 'Team Members',
                icon: '👥',
                href: '/team-members.html',
                description: 'Active team members and communication'
            },
            {
                id: 'team-member-history',
                label: 'History',
                icon: '📜',
                href: '/team-member-history.html',
                description: 'Team member activity history'
            },
            {
                id: 'memory-recall',
                label: 'Recall',
                icon: '🔍',
                href: '/memory-recall.html',
                description: 'Search and recall memories'
            },
            {
                id: 'memory-controls',
                label: 'Controls',
                shortLabel: 'Mem Ctrl',
                icon: '📈',
                href: '/memory-controls.html',
                description: 'Memory management controls'
            },
            {
                id: 'prompt-console',
                label: 'Console',
                icon: '💻',
                href: '/prompt-console.html',
                description: 'Interactive prompt console'
            },
            {
                id: 'terminal',
                label: 'Terminal',
                icon: '⌨️',
                href: '/terminal.html',
                description: 'Live terminal viewer'
            },
            {
                id: 'hooks',
                label: 'Hooks',
                icon: '🪝',
                href: '/hooks.html',
                description: 'Manage custom  hooks'
            }
        ];
    }

    init() {
        this.render();
        this.attachEventListeners();
        this.highlightCurrentPage();
    }

    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.warn(`Navigation container #${this.containerId} not found`);
            return;
        }

        const nav = document.createElement('nav');
        nav.className = 'specmem-nav';
        nav.setAttribute('role', 'navigation');
        nav.setAttribute('aria-label', 'Main navigation');

        this.navItems.forEach(item => {
            const navItem = this.createNavItem(item);
            nav.appendChild(navItem);
        });

        container.appendChild(nav);
    }

    createNavItem(item) {
        const element = document.createElement('a');
        element.href = item.href;
        element.className = 'nav-item';
        element.dataset.page = item.id;
        element.dataset.section = item.section || '';
        element.setAttribute('aria-label', item.description);
        element.setAttribute('title', item.description);

        // Icon
        const icon = document.createElement('span');
        icon.className = 'nav-icon';
        icon.textContent = item.icon;
        icon.setAttribute('aria-hidden', 'true');

        // Label
        const label = document.createElement('span');
        label.className = 'nav-label';
        label.textContent = item.shortLabel || item.label;

        element.appendChild(icon);
        element.appendChild(label);

        return element;
    }

    highlightCurrentPage() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            const page = item.dataset.page;
            if (page === this.currentPage ||
                (this.currentPage === '' && page === 'index')) {
                item.classList.add('active');
                item.setAttribute('aria-current', 'page');
            }
        });
    }

    attachEventListeners() {
        // Keyboard navigation
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach((item, index) => {
            item.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    const next = navItems[index + 1] || navItems[0];
                    next.focus();
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const prev = navItems[index - 1] || navItems[navItems.length - 1];
                    prev.focus();
                }
            });

            // Touch feedback
            item.addEventListener('touchstart', function() {
                this.classList.add('touching');
            });

            item.addEventListener('touchend', function() {
                this.classList.remove('touching');
            });
        });

        // Add active state on click
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                // For section-based navigation (single-page apps)
                if (item.dataset.section && typeof showSection === 'function') {
                    e.preventDefault();
                    navItems.forEach(n => n.classList.remove('active'));
                    item.classList.add('active');
                    showSection(item.dataset.section);
                }
            });
        });
    }

    static injectStyles() {
        const styleId = 'specmem-nav-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .specmem-nav {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 10px 0;
            }

            .nav-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 12px 8px;
                cursor: pointer;
                transition: all var(--transition-fast, 0.15s ease);
                border-left: 3px solid transparent;
                text-decoration: none;
                color: var(--csgo-text, #e0e0e0);
                position: relative;
            }

            .nav-item:hover {
                background: rgba(255, 215, 0, 0.1);
                border-left-color: var(--csgo-yellow, #FFD700);
            }

            .nav-item.active {
                background: rgba(255, 215, 0, 0.15);
                border-left-color: var(--csgo-yellow, #FFD700);
            }

            .nav-item.active::after {
                content: '';
                position: absolute;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 4px;
                height: 60%;
                background: var(--csgo-yellow, #FFD700);
                border-radius: 2px 0 0 2px;
                box-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
            }

            .nav-icon {
                font-size: 24px;
                margin-bottom: 5px;
                transition: all var(--transition-fast, 0.15s ease);
                filter: grayscale(0.5);
            }

            .nav-item:hover .nav-icon,
            .nav-item.active .nav-icon {
                color: var(--csgo-yellow, #FFD700);
                text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
                filter: grayscale(0);
                transform: scale(1.1);
            }

            .nav-label {
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--csgo-text-dim, #888);
                transition: color var(--transition-fast, 0.15s ease);
            }

            .nav-item:hover .nav-label,
            .nav-item.active .nav-label {
                color: var(--csgo-text, #e0e0e0);
            }

            .nav-item.touching {
                background: rgba(255, 215, 0, 0.25) !important;
                border-color: var(--csgo-yellow, #FFD700) !important;
            }

            /* Mobile responsive */
            @media (max-width: 480px) {
                .specmem-nav {
                    flex-direction: row;
                    overflow-x: auto;
                    padding: 0;
                    gap: 0;
                }

                .nav-item {
                    flex: 0 0 auto;
                    min-width: 60px;
                    border-left: none;
                    border-top: 3px solid transparent;
                }

                .nav-item:hover,
                .nav-item.active {
                    border-left: none;
                    border-top-color: var(--csgo-yellow, #FFD700);
                }

                .nav-item.active::after {
                    display: none;
                }

                .nav-icon {
                    font-size: 20px;
                    margin-bottom: 2px;
                }

                .nav-label {
                    font-size: 8px;
                }
            }
        `;

        document.head.appendChild(style);
    }
}

// Auto-inject styles when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        SpecMemNavigation.injectStyles();
    });
} else {
    SpecMemNavigation.injectStyles();
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpecMemNavigation;
}
