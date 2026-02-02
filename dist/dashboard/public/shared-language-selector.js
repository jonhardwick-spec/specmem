/**
 * SPECMEM Language Selector Component
 * Provides language selection with country flag icons
 * Stores selection in localStorage for persistence
 */

class SpecMemLanguageSelector {
    constructor(options = {}) {
        this.containerId = options.containerId || null;
        this.position = options.position || 'header'; // 'header', 'custom'
        this.storageKey = options.storageKey || 'specmem-language';
        this.currentLanguage = this.loadLanguage();
        this.isOpen = false;
        this.onLanguageChange = options.onLanguageChange || null;

        this.languages = [
            {
                code: 'en',
                name: 'English',
                nativeName: 'English',
                flag: this.getFlagSVG('us')
            },
            {
                code: 'zh-CN',
                name: 'Chinese (Simplified)',
                nativeName: '\u7b80\u4f53\u4e2d\u6587',
                flag: this.getFlagSVG('cn')
            },
            {
                code: 'zh-TW',
                name: 'Chinese (Traditional)',
                nativeName: '\u7e41\u9ad4\u4e2d\u6587',
                flag: this.getFlagSVG('tw')
            },
            {
                code: 'es',
                name: 'Spanish',
                nativeName: 'Espa\u00f1ol',
                flag: this.getFlagSVG('es')
            },
            {
                code: 'ja',
                name: 'Japanese',
                nativeName: '\u65e5\u672c\u8a9e',
                flag: this.getFlagSVG('jp')
            },
            {
                code: 'ko',
                name: 'Korean',
                nativeName: '\ud55c\uad6d\uc5b4',
                flag: this.getFlagSVG('kr')
            }
        ];

        this.init();
    }

    getFlagSVG(countryCode) {
        // Inline SVG flags for reliable rendering
        const flags = {
            // United States
            us: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7410 3900">
                <rect width="7410" height="3900" fill="#b22234"/>
                <path d="M0,450H7410m0,600H0m0,600H7410m0,600H0m0,600H7410m0,600H0" stroke="#fff" stroke-width="300"/>
                <rect width="2964" height="2100" fill="#3c3b6e"/>
                <g fill="#fff">
                    <g id="s18"><g id="s9"><g id="s5"><g id="s4"><path id="s" d="M247,90 317.534230,307.082039 132.873218,172.917961H361.126782L176.465770,307.082039z"/><use href="#s" y="420"/><use href="#s" y="840"/><use href="#s" y="1260"/></g><use href="#s4" y="1680"/></g><use href="#s5" x="247" y="210"/></g><use href="#s9" x="494"/></g><use href="#s18" x="988"/><use href="#s9" x="1976"/><use href="#s5" x="2470"/>
                </g>
            </svg>`,

            // China
            cn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">
                <rect width="30" height="20" fill="#de2910"/>
                <g fill="#ffde00">
                    <polygon points="5,4 5.9,6.8 3,5.3 7,5.3 4.1,6.8"/>
                    <polygon points="10,1 10.3,2.5 8.8,1.5 11.2,1.5 9.7,2.5"/>
                    <polygon points="12,3 11.7,4.5 10.2,3.5 12.6,3.5 11.1,4.5" transform="rotate(15 12 3)"/>
                    <polygon points="12,6 11.7,7.5 10.2,6.5 12.6,6.5 11.1,7.5" transform="rotate(-15 12 6)"/>
                    <polygon points="10,8 10.3,9.5 8.8,8.5 11.2,8.5 9.7,9.5"/>
                </g>
            </svg>`,

            // Taiwan
            tw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">
                <rect width="30" height="20" fill="#fe0000"/>
                <rect width="15" height="10" fill="#000095"/>
                <g fill="#fff" transform="translate(7.5,5)">
                    <circle r="3"/>
                    <g id="tw-ray">
                        <polygon points="0,-4.5 0.5,-1.5 -0.5,-1.5"/>
                    </g>
                    <use href="#tw-ray" transform="rotate(30)"/>
                    <use href="#tw-ray" transform="rotate(60)"/>
                    <use href="#tw-ray" transform="rotate(90)"/>
                    <use href="#tw-ray" transform="rotate(120)"/>
                    <use href="#tw-ray" transform="rotate(150)"/>
                    <use href="#tw-ray" transform="rotate(180)"/>
                    <use href="#tw-ray" transform="rotate(210)"/>
                    <use href="#tw-ray" transform="rotate(240)"/>
                    <use href="#tw-ray" transform="rotate(270)"/>
                    <use href="#tw-ray" transform="rotate(300)"/>
                    <use href="#tw-ray" transform="rotate(330)"/>
                </g>
                <circle cx="7.5" cy="5" r="2" fill="#000095"/>
            </svg>`,

            // Spain
            es: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">
                <rect width="30" height="20" fill="#c60b1e"/>
                <rect y="5" width="30" height="10" fill="#ffc400"/>
            </svg>`,

            // Japan
            jp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">
                <rect width="30" height="20" fill="#fff"/>
                <circle cx="15" cy="10" r="6" fill="#bc002d"/>
            </svg>`,

            // South Korea
            kr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">
                <rect width="30" height="20" fill="#fff"/>
                <circle cx="15" cy="10" r="5" fill="#c60c30"/>
                <path d="M15,5 a5,5 0 0,1 0,10 a2.5,2.5 0 0,1 0,-5 a2.5,2.5 0 0,0 0,-5" fill="#003478"/>
                <g stroke="#000" stroke-width="0.6" fill="none">
                    <g transform="translate(6,4) rotate(-56)">
                        <line x1="-3" y1="0" x2="3" y2="0"/>
                        <line x1="-3" y1="1" x2="3" y2="1"/>
                        <line x1="-3" y1="2" x2="3" y2="2"/>
                    </g>
                    <g transform="translate(24,4) rotate(56)">
                        <line x1="-3" y1="0" x2="3" y2="0"/>
                        <line x1="-3" y1="1" x2="1.5" y2="1"/><line x1="2" y1="1" x2="3" y2="1"/>
                        <line x1="-3" y1="2" x2="3" y2="2"/>
                    </g>
                    <g transform="translate(6,16) rotate(56)">
                        <line x1="-3" y1="0" x2="3" y2="0"/>
                        <line x1="-1.5" y1="-1" x2="3" y2="-1"/><line x1="-3" y1="-1" x2="-2" y2="-1"/>
                        <line x1="-3" y1="-2" x2="3" y2="-2"/>
                    </g>
                    <g transform="translate(24,16) rotate(-56)">
                        <line x1="-3" y1="0" x2="-1" y2="0"/><line x1="1" y1="0" x2="3" y2="0"/>
                        <line x1="-3" y1="-1" x2="-1" y2="-1"/><line x1="1" y1="-1" x2="3" y2="-1"/>
                        <line x1="-3" y1="-2" x2="-1" y2="-2"/><line x1="1" y1="-2" x2="3" y2="-2"/>
                    </g>
                </g>
            </svg>`
        };

        return flags[countryCode] || flags['us'];
    }

    loadLanguage() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            return saved || 'en';
        } catch (e) {
            return 'en';
        }
    }

    saveLanguage(langCode) {
        try {
            localStorage.setItem(this.storageKey, langCode);
        } catch (e) {
            console.warn('Failed to save language preference:', e);
        }
    }

    getCurrentLanguage() {
        return this.languages.find(l => l.code === this.currentLanguage) || this.languages[0];
    }

    init() {
        this.injectStyles();
        this.render();
        this.attachEventListeners();
    }

    render() {
        const selector = document.createElement('div');
        selector.className = 'language-selector';
        selector.id = 'language-selector';
        selector.setAttribute('role', 'combobox');
        selector.setAttribute('aria-expanded', 'false');
        selector.setAttribute('aria-haspopup', 'listbox');
        selector.setAttribute('aria-label', 'Select language');

        // Current language button
        const currentLang = this.getCurrentLanguage();
        const button = document.createElement('button');
        button.className = 'language-selector-button';
        button.type = 'button';
        button.setAttribute('aria-label', `Current language: ${currentLang.name}. Click to change.`);
        button.innerHTML = `
            <span class="flag-icon">${currentLang.flag}</span>
            <span class="language-code">${currentLang.code.split('-')[0].toUpperCase()}</span>
            <span class="dropdown-arrow">
                <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
                    <path d="M1 1l4 4 4-4"/>
                </svg>
            </span>
        `;

        // Dropdown menu
        const dropdown = document.createElement('div');
        dropdown.className = 'language-dropdown';
        dropdown.setAttribute('role', 'listbox');
        dropdown.setAttribute('aria-label', 'Available languages');

        this.languages.forEach(lang => {
            const option = document.createElement('div');
            option.className = 'language-option';
            option.dataset.langCode = lang.code;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', lang.code === this.currentLanguage ? 'true' : 'false');
            option.innerHTML = `
                <span class="flag-icon">${lang.flag}</span>
                <span class="language-info">
                    <span class="language-native">${lang.nativeName}</span>
                    <span class="language-name">${lang.name}</span>
                </span>
                ${lang.code === this.currentLanguage ? '<span class="check-mark"><svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor"><path d="M1 5l3 3 7-7"/></svg></span>' : ''}
            `;
            dropdown.appendChild(option);
        });

        selector.appendChild(button);
        selector.appendChild(dropdown);

        // Insert into DOM
        if (this.containerId) {
            const container = document.getElementById(this.containerId);
            if (container) {
                container.appendChild(selector);
            }
        } else if (this.position === 'header') {
            // Insert into header stats area
            const headerStats = document.querySelector('.header-stats');
            if (headerStats) {
                headerStats.insertBefore(selector, headerStats.firstChild);
            } else {
                // Fallback: Insert into header
                const header = document.querySelector('.header, .specmem-header');
                if (header) {
                    header.appendChild(selector);
                }
            }
        }

        this.selectorElement = selector;
        this.buttonElement = button;
        this.dropdownElement = dropdown;
    }

    attachEventListeners() {
        // Toggle dropdown on button click
        this.buttonElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Handle language selection
        this.dropdownElement.addEventListener('click', (e) => {
            const option = e.target.closest('.language-option');
            if (option) {
                const langCode = option.dataset.langCode;
                this.selectLanguage(langCode);
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.selectorElement.contains(e.target)) {
                this.closeDropdown();
            }
        });

        // Keyboard navigation
        this.selectorElement.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    if (!this.isOpen) {
                        this.openDropdown();
                    } else {
                        const focused = this.dropdownElement.querySelector('.language-option:focus');
                        if (focused) {
                            this.selectLanguage(focused.dataset.langCode);
                        }
                    }
                    break;
                case 'Escape':
                    this.closeDropdown();
                    this.buttonElement.focus();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    if (!this.isOpen) {
                        this.openDropdown();
                    } else {
                        this.focusNextOption();
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.focusPreviousOption();
                    break;
            }
        });
    }

    toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        this.isOpen = true;
        this.selectorElement.classList.add('open');
        this.selectorElement.setAttribute('aria-expanded', 'true');

        // Focus first option
        const firstOption = this.dropdownElement.querySelector('.language-option');
        if (firstOption) {
            firstOption.setAttribute('tabindex', '0');
            firstOption.focus();
        }
    }

    closeDropdown() {
        this.isOpen = false;
        this.selectorElement.classList.remove('open');
        this.selectorElement.setAttribute('aria-expanded', 'false');
    }

    focusNextOption() {
        const options = this.dropdownElement.querySelectorAll('.language-option');
        const focused = document.activeElement;
        const index = Array.from(options).indexOf(focused);
        const nextIndex = index < options.length - 1 ? index + 1 : 0;
        options[nextIndex].setAttribute('tabindex', '0');
        options[nextIndex].focus();
        if (index >= 0) options[index].setAttribute('tabindex', '-1');
    }

    focusPreviousOption() {
        const options = this.dropdownElement.querySelectorAll('.language-option');
        const focused = document.activeElement;
        const index = Array.from(options).indexOf(focused);
        const prevIndex = index > 0 ? index - 1 : options.length - 1;
        options[prevIndex].setAttribute('tabindex', '0');
        options[prevIndex].focus();
        if (index >= 0) options[index].setAttribute('tabindex', '-1');
    }

    selectLanguage(langCode) {
        const lang = this.languages.find(l => l.code === langCode);
        if (!lang) return;

        this.currentLanguage = langCode;
        this.saveLanguage(langCode);
        this.updateDisplay(lang);
        this.closeDropdown();

        // Emit custom event
        const event = new CustomEvent('languagechange', {
            detail: {
                code: langCode,
                name: lang.name,
                nativeName: lang.nativeName
            },
            bubbles: true
        });
        this.selectorElement.dispatchEvent(event);

        // Call callback if provided
        if (typeof this.onLanguageChange === 'function') {
            this.onLanguageChange(langCode, lang);
        }
    }

    updateDisplay(lang) {
        // Update button
        const flagIcon = this.buttonElement.querySelector('.flag-icon');
        const langCode = this.buttonElement.querySelector('.language-code');
        if (flagIcon) flagIcon.innerHTML = lang.flag;
        if (langCode) langCode.textContent = lang.code.split('-')[0].toUpperCase();

        // Update aria-selected states
        this.dropdownElement.querySelectorAll('.language-option').forEach(opt => {
            const isSelected = opt.dataset.langCode === lang.code;
            opt.setAttribute('aria-selected', isSelected ? 'true' : 'false');

            // Update check mark
            const existingCheck = opt.querySelector('.check-mark');
            if (isSelected && !existingCheck) {
                const check = document.createElement('span');
                check.className = 'check-mark';
                check.innerHTML = '<svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor"><path d="M1 5l3 3 7-7"/></svg>';
                opt.appendChild(check);
            } else if (!isSelected && existingCheck) {
                existingCheck.remove();
            }
        });
    }

    getSelectedLanguage() {
        return {
            code: this.currentLanguage,
            ...this.getCurrentLanguage()
        };
    }

    injectStyles() {
        const styleId = 'specmem-language-selector-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .language-selector {
                position: relative;
                display: inline-flex;
                align-items: center;
                z-index: 1001;
            }

            .language-selector-button {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                background: rgba(255, 215, 0, 0.05);
                border: 1px solid rgba(255, 215, 0, 0.2);
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                font-family: 'Rajdhani', sans-serif;
            }

            .language-selector-button:hover {
                background: rgba(255, 215, 0, 0.1);
                border-color: rgba(255, 215, 0, 0.4);
                box-shadow: 0 0 10px rgba(255, 215, 0, 0.2);
            }

            .language-selector.open .language-selector-button {
                background: rgba(255, 215, 0, 0.15);
                border-color: var(--csgo-yellow, #FFD700);
            }

            .flag-icon {
                width: 22px;
                height: 16px;
                border-radius: 3px;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
            }

            .flag-icon svg {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .language-code {
                font-size: 12px;
                font-weight: 600;
                color: var(--csgo-text, #e0e0e0);
                letter-spacing: 1px;
                min-width: 20px;
                text-align: center;
            }

            .dropdown-arrow {
                display: flex;
                align-items: center;
                color: var(--csgo-text-dim, #888);
                transition: transform 0.2s ease;
            }

            .language-selector.open .dropdown-arrow {
                transform: rotate(180deg);
                color: var(--csgo-yellow, #FFD700);
            }

            .language-dropdown {
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                min-width: 220px;
                background: rgba(20, 20, 20, 0.98);
                border: 1px solid rgba(255, 215, 0, 0.3);
                border-radius: 8px;
                padding: 8px 0;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-10px);
                transition: all 0.2s ease;
                box-shadow:
                    0 8px 32px rgba(0, 0, 0, 0.5),
                    0 0 20px rgba(255, 215, 0, 0.1);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
            }

            .language-selector.open .language-dropdown {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            .language-option {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 16px;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .language-option:hover {
                background: rgba(255, 215, 0, 0.1);
            }

            .language-option:focus {
                outline: none;
                background: rgba(255, 215, 0, 0.15);
            }

            .language-option[aria-selected="true"] {
                background: rgba(255, 215, 0, 0.08);
            }

            .language-option .flag-icon {
                width: 24px;
                height: 18px;
                flex-shrink: 0;
            }

            .language-info {
                display: flex;
                flex-direction: column;
                flex: 1;
                min-width: 0;
            }

            .language-native {
                font-size: 14px;
                font-weight: 600;
                color: var(--csgo-text, #e0e0e0);
                line-height: 1.2;
            }

            .language-name {
                font-size: 11px;
                color: var(--csgo-text-dim, #888);
                line-height: 1.2;
            }

            .check-mark {
                display: flex;
                align-items: center;
                color: var(--csgo-yellow, #FFD700);
                margin-left: auto;
                flex-shrink: 0;
            }

            /* Responsive adjustments */
            @media (max-width: 768px) {
                .language-code {
                    display: none;
                }

                .language-dropdown {
                    right: -10px;
                    min-width: 200px;
                }
            }

            @media (max-width: 480px) {
                .language-selector-button {
                    padding: 4px 8px;
                }

                .flag-icon {
                    width: 20px;
                    height: 14px;
                }

                .language-dropdown {
                    position: fixed;
                    top: auto;
                    bottom: 70px;
                    left: 10px;
                    right: 10px;
                    min-width: auto;
                }

                .language-option {
                    padding: 12px 16px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    destroy() {
        if (this.selectorElement) {
            this.selectorElement.remove();
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpecMemLanguageSelector;
}
