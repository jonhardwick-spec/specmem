/**
 * SPECMEM Shared Header Component
 * Provides consistent header with stats across all dashboard pages
 */

class SpecMemHeader {
    constructor(options = {}) {
        this.title = options.title || 'SPECMEM';
        this.subtitle = options.subtitle || 'TACTICAL MEMORY OPERATIONS';
        this.showStats = options.showStats !== false;
        this.statsEndpoint = options.statsEndpoint || '/api/specmem/stats';
        this.refreshInterval = options.refreshInterval || 5000;
        this.stats = {
            totalMemories: 0,
            activeTeamMembers: 0,
            systemStatus: 'Operational'
        };
        this.refreshTimer = null;
        this.init();
    }

    init() {
        this.injectStyles();
        this.render();
        if (this.showStats) {
            this.loadStats();
            this.startAutoRefresh();
        }
    }

    render() {
        const header = document.createElement('header');
        header.className = 'specmem-header';
        header.setAttribute('role', 'banner');

        // Logo section
        const logo = document.createElement('div');
        logo.className = 'header-logo';
        logo.innerHTML = `
            <span class="logo-text">
                <span class="logo-primary">${this.title}</span>
                <span class="logo-secondary">${this.subtitle}</span>
            </span>
        `;

        // Stats section
        const stats = document.createElement('div');
        stats.className = 'header-stats';
        stats.id = 'header-stats';

        if (this.showStats) {
            stats.innerHTML = this.renderStats();
        }

        header.appendChild(logo);
        header.appendChild(stats);

        // Insert at the beginning of body
        document.body.insertBefore(header, document.body.firstChild);
    }

    renderStats() {
        return `
            <div class="stat-item" title="Total memories in the system">
                <span class="stat-value" id="stat-memories">${this.formatNumber(this.stats.totalMemories)}</span>
                <span class="stat-label">MEMORIES</span>
            </div>
            <div class="stat-item" title="Currently active team members">
                <span class="stat-value" id="stat-teamMembers">${this.stats.activeTeamMembers}</span>
                <span class="stat-label">AGENTS</span>
            </div>
            <div class="stat-item" title="System operational status">
                <span class="stat-value status-${this.stats.systemStatus.toLowerCase()}" id="stat-status">
                    ${this.stats.systemStatus}
                </span>
                <span class="stat-label">STATUS</span>
            </div>
        `;
    }

    formatNumber(num) {
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    async loadStats() {
        try {
            const response = await fetch(this.statsEndpoint);
            if (response.ok) {
                const data = await response.json();
                this.updateStats(data);
            }
        } catch (error) {
            console.warn('Failed to load header stats:', error);
        }
    }

    updateStats(data) {
        // Update internal state
        this.stats.totalMemories = data.totalMemories || data.total || 0;
        this.stats.activeTeamMembers = data.activeTeamMembers || 0;
        this.stats.systemStatus = data.status || 'Operational';

        // Update DOM
        const memEl = document.getElementById('stat-memories');
        const teamMembersEl = document.getElementById('stat-teamMembers');
        const statusEl = document.getElementById('stat-status');

        if (memEl) {
            memEl.textContent = this.formatNumber(this.stats.totalMemories);
            memEl.classList.add('stat-updated');
            setTimeout(() => memEl.classList.remove('stat-updated'), 300);
        }

        if (teamMembersEl) {
            team membersEl.textContent = this.stats.activeTeamMembers;
            team membersEl.classList.add('stat-updated');
            setTimeout(() => team membersEl.classList.remove('stat-updated'), 300);
        }

        if (statusEl) {
            statusEl.textContent = this.stats.systemStatus;
            statusEl.className = `stat-value status-${this.stats.systemStatus.toLowerCase()}`;
        }
    }

    startAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        this.refreshTimer = setInterval(() => this.loadStats(), this.refreshInterval);
    }

    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    injectStyles() {
        const styleId = 'specmem-header-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .specmem-header {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                height: 60px;
                background: linear-gradient(180deg, var(--csgo-dark, #0a0a0a) 0%, var(--csgo-black, #000) 100%);
                border-bottom: 2px solid var(--csgo-yellow, #FFD700);
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 20px;
                z-index: 1000;
                box-shadow: 0 4px 20px rgba(255, 215, 0, 0.2);
            }

            .header-logo {
                display: flex;
                align-items: center;
                gap: 15px;
            }

            .logo-text {
                display: flex;
                flex-direction: column;
                line-height: 1.2;
            }

            .logo-primary {
                font-family: 'Orbitron', monospace;
                font-size: 24px;
                font-weight: 700;
                color: var(--csgo-yellow, #FFD700);
                text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
                letter-spacing: 3px;
            }

            .logo-secondary {
                font-family: 'Rajdhani', sans-serif;
                font-size: 10px;
                color: var(--csgo-text-dim, #888);
                letter-spacing: 2px;
                text-transform: uppercase;
            }

            .header-stats {
                display: flex;
                gap: 30px;
                font-size: 14px;
            }

            .stat-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                min-width: 70px;
            }

            .stat-value {
                font-family: 'Orbitron', monospace;
                font-size: 18px;
                color: var(--csgo-yellow, #FFD700);
                text-shadow: 0 0 5px rgba(255, 215, 0, 0.5);
                font-weight: 600;
                transition: all 0.3s ease;
            }

            .stat-value.stat-updated {
                transform: scale(1.1);
                text-shadow: 0 0 15px rgba(255, 215, 0, 0.8);
            }

            .stat-value.status-operational {
                color: var(--csgo-success, #4CAF50);
                text-shadow: 0 0 5px rgba(76, 175, 80, 0.5);
            }

            .stat-value.status-warning {
                color: var(--csgo-warning, #ff9800);
                text-shadow: 0 0 5px rgba(255, 152, 0, 0.5);
            }

            .stat-value.status-error {
                color: var(--csgo-error, #f44336);
                text-shadow: 0 0 5px rgba(244, 67, 54, 0.5);
            }

            .stat-label {
                font-size: 10px;
                color: var(--csgo-text-dim, #888);
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-top: 2px;
            }

            /* Responsive adjustments */
            @media (max-width: 768px) {
                .specmem-header {
                    padding: 0 15px;
                }

                .logo-primary {
                    font-size: 20px;
                    letter-spacing: 2px;
                }

                .logo-secondary {
                    font-size: 8px;
                }

                .header-stats {
                    gap: 20px;
                }

                .stat-value {
                    font-size: 16px;
                }

                .stat-label {
                    font-size: 8px;
                }
            }

            @media (max-width: 480px) {
                .logo-secondary {
                    display: none;
                }

                .header-stats {
                    gap: 12px;
                }

                .stat-item {
                    min-width: 50px;
                }

                .stat-value {
                    font-size: 14px;
                }

                .stat-label {
                    font-size: 7px;
                }
            }

            @media (max-width: 360px) {
                .logo-primary {
                    font-size: 16px;
                }

                .header-stats {
                    gap: 8px;
                }

                .stat-value {
                    font-size: 12px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    destroy() {
        this.stopAutoRefresh();
        const header = document.querySelector('.specmem-header');
        if (header) {
            header.remove();
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpecMemHeader;
}
