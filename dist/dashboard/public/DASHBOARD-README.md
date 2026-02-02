# SPECMEM Dashboard - Shared Components

Modern, accessible, and consistent UI components for the SPECMEM dashboard.

## Overview

The dashboard has been enhanced with shared components to ensure consistency across all pages and improve maintainability.

### Created Files

1. **shared-theme.css** - Core theme with CSS variables
2. **shared-nav.js** - Reusable navigation component
3. **shared-header.js** - Consistent header with live stats
4. **index-improvements.css** - Enhanced animations and modern styles
5. **example-page.html** - Template showing component usage

## Quick Start

### Basic Page Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SPECMEM // Your Page Title</title>

    <!-- Include shared theme -->
    <link rel="stylesheet" href="/shared-theme.css">

    <!-- Your page-specific styles -->
    <style>
        body { padding-top: 60px; }
        .main-container {
            display: grid;
            grid-template-columns: 80px 1fr;
            min-height: calc(100vh - 60px);
        }
        /* Add your styles here */
    </style>
</head>
<body>
    <div class="main-container">
        <aside class="nav-panel">
            <div id="specmem-nav"></div>
        </aside>

        <main class="content-area">
            <!-- Your content here -->
        </main>
    </div>

    <!-- Include shared components -->
    <script src="/shared-header.js"></script>
    <script src="/shared-nav.js"></script>

    <script>
        // Initialize components
        const header = new SpecMemHeader({
            title: 'SPECMEM',
            subtitle: 'YOUR PAGE SUBTITLE'
        });

        const nav = new SpecMemNavigation({
            currentPage: 'your-page-name'
        });
    </script>
</body>
</html>
```

## Component Documentation

### 1. Shared Theme (shared-theme.css)

Provides consistent colors, typography, spacing, and utilities.

#### CSS Variables

```css
/* Colors */
--csgo-yellow: #FFD700;
--csgo-black: #000000;
--csgo-dark: #0a0a0a;
--csgo-text: #e0e0e0;

/* Spacing */
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;

/* Transitions */
--transition-fast: 0.15s ease;
--transition-normal: 0.3s ease;
```

#### Utility Classes

```html
<!-- Text colors -->
<p class="text-yellow">Yellow text</p>
<p class="text-success">Success (green)</p>
<p class="text-error">Error (red)</p>
<p class="text-warning">Warning (orange)</p>

<!-- Effects -->
<h1 class="glow-yellow">Glowing text</h1>
<div class="shadow-yellow">Yellow shadow box</div>

<!-- Animations -->
<div class="fade-in">Fades in</div>
<div class="slide-in-up">Slides up</div>
<div class="pulse">Pulses</div>
```

### 2. Navigation Component (shared-nav.js)

Provides consistent navigation across all pages.

#### Basic Usage

```javascript
const nav = new SpecMemNavigation({
    currentPage: 'index',  // Auto-highlights this page
    containerId: 'specmem-nav'  // Where to render
});
```

#### Custom Navigation Items

```javascript
const nav = new SpecMemNavigation({
    currentPage: 'custom',
    navItems: [
        {
            id: 'home',
            label: 'Home',
            icon: '🏠',
            href: '/index.html',
            description: 'Go to home page'
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: '⚙️',
            href: '/settings.html',
            description: 'Configure settings'
        }
    ]
});
```

#### Features

- **Keyboard Navigation**: Arrow keys to navigate between items
- **Touch Support**: Touch feedback on mobile devices
- **Accessibility**: ARIA labels and semantic HTML
- **Auto-detection**: Automatically detects and highlights current page
- **Responsive**: Adapts to mobile (bottom bar) and desktop (sidebar)

### 3. Header Component (shared-header.js)

Displays consistent header with live stats.

#### Basic Usage

```javascript
const header = new SpecMemHeader({
    title: 'SPECMEM',
    subtitle: 'TACTICAL MEMORY OPERATIONS',
    showStats: true,
    refreshInterval: 5000  // Update stats every 5 seconds
});
```

#### Custom Stats Endpoint

```javascript
const header = new SpecMemHeader({
    title: 'SPECMEM',
    statsEndpoint: '/api/custom/stats',
    refreshInterval: 3000
});
```

#### Methods

```javascript
// Manually update stats
header.updateStats({
    totalMemories: 1234,
    activeTeamMembers: 5,
    status: 'Operational'
});

// Stop auto-refresh
header.stopAutoRefresh();

// Restart auto-refresh
header.startAutoRefresh();

// Remove header
header.destroy();
```

### 4. Index Improvements (index-improvements.css)

Modern enhancements for existing pages. Add to index.html:

```html
<link rel="stylesheet" href="/index-improvements.css">
```

#### Features

- **Card Animations**: Staggered entrance animations
- **Hover Effects**: Lift effect on hover
- **Loading States**: Skeleton loaders and spinners
- **Enhanced Buttons**: Ripple effects
- **Status Indicators**: Pulsing online indicators
- **Smooth Scrollbars**: Themed scrollbars
- **Modal Animations**: Fade and slide effects
- **Accessibility**: Reduced motion support

#### Usage Examples

```html
<!-- Loading skeleton -->
<div class="loading-skeleton" style="height: 100px;"></div>

<!-- Loading spinner -->
<div class="loading-spinner"></div>

<!-- Status indicator -->
<span class="status-indicator online"></span> Online
<span class="status-indicator offline"></span> Offline
<span class="status-indicator error"></span> Error
```

## Updating Existing Pages

### To Modernize index.html

1. Add at the top of `<head>`:
   ```html
   <link rel="stylesheet" href="/shared-theme.css">
   <link rel="stylesheet" href="/index-improvements.css">
   ```

2. Your existing styles will work alongside these improvements

3. Optionally replace header/nav with shared components

### To Modernize team-members.html

1. Same as above
2. Use shared navigation:
   ```html
   <div id="specmem-nav"></div>
   <script src="/shared-nav.js"></script>
   <script>
       new SpecMemNavigation({ currentPage: 'team-members' });
   </script>
   ```

## Responsive Design

All components are mobile-responsive:

- **Desktop (>768px)**: Side navigation, full stats
- **Tablet (481-768px)**: Compact navigation
- **Mobile (<480px)**: Bottom navigation bar, simplified header

## Accessibility Features

- **Keyboard Navigation**: Tab, arrow keys, Enter/Space
- **ARIA Labels**: Proper semantic HTML and ARIA attributes
- **Focus Indicators**: Clear focus outlines
- **Screen Reader Support**: Descriptive labels
- **Reduced Motion**: Respects `prefers-reduced-motion`
- **Color Contrast**: WCAG AA compliant

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile browsers: iOS Safari, Chrome Android

## Performance

- **GPU Acceleration**: Transform animations use GPU
- **Will-change**: Optimized for animations
- **Lazy Loading**: Components initialize only when needed
- **Debounced Updates**: Stats refresh is throttled

## Theming

### Dark Mode (Default)

Already optimized for dark mode with CS:GO-inspired yellow/black theme.

### Light Mode (Optional)

Add class to body:

```html
<body class="light-mode">
```

### Custom Colors

Override CSS variables:

```css
:root {
    --csgo-yellow: #your-color;
    --csgo-success: #your-success;
}
```

## Best Practices

1. **Always include shared-theme.css** for consistency
2. **Use CSS variables** instead of hardcoded colors
3. **Add ARIA labels** to interactive elements
4. **Test on mobile** - components are responsive
5. **Use utility classes** instead of writing custom CSS
6. **Lazy load** if page has many components

## Examples

See **example-page.html** for a complete working example.

## Migration Checklist

For existing pages:

- [ ] Include `shared-theme.css`
- [ ] Include `index-improvements.css` (optional but recommended)
- [ ] Replace hardcoded colors with CSS variables
- [ ] Add ARIA labels to buttons/links
- [ ] Test keyboard navigation
- [ ] Test on mobile devices
- [ ] Verify reduced motion support

## Troubleshooting

### Navigation not showing
- Ensure `<div id="specmem-nav"></div>` exists
- Check browser console for errors
- Verify script loaded: `typeof SpecMemNavigation`

### Header stats not updating
- Check `/api/specmem/stats` endpoint
- Verify no CORS errors
- Call `header.loadStats()` manually to test

### Styles not applying
- Check CSS file paths are correct
- Ensure no conflicting styles
- Check browser DevTools for CSS errors

## Contributing

When adding new pages:

1. Use the template above
2. Follow existing naming conventions
3. Add your page to navigation items
4. Test accessibility
5. Document any new components

## License

Part of the SPECMEM project.
