# Integration Guide - Shared Components

Quick guide for Alpha and future developers to integrate shared components into existing pages.

## What's Been Created

### Core Components (Ready to Use)
1. **shared-theme.css** - CSS variables, utilities, animations
2. **shared-nav.js** - Navigation component with keyboard/touch support
3. **shared-header.js** - Header with live stats
4. **shared-toast.js** - Toast notification system
5. **index-improvements.css** - Modern enhancements for existing pages
6. **example-page.html** - Working example template

### Documentation
- **DASHBOARD-README.md** - Full component documentation
- **INTEGRATION-GUIDE.md** - This file

## Quick Integration for index.html

### Option 1: Minimal Integration (Add Improvements Only)

Add these two lines to the `<head>` section:

```html
<link rel="stylesheet" href="/shared-theme.css">
<link rel="stylesheet" href="/index-improvements.css">
```

**Benefits:**
- Modern animations and effects
- Better loading states
- Enhanced hover effects
- Smooth transitions
- No code changes required
- Works with existing structure

### Option 2: Full Integration (Replace Header & Nav)

1. **Replace the existing header** (around line 2105):

```html
<!-- OLD: Remove this -->
<header class="header">
    <div class="logo">SPECMEM <span>// TACTICAL OPS</span></div>
    ...
</header>

<!-- NEW: Header will be injected by JavaScript -->
```

2. **Replace the navigation** (around line 2131):

```html
<!-- OLD: Remove this -->
<nav class="nav-panel">
    <div class="nav-item active" ...>
    ...
</nav>

<!-- NEW: -->
<nav class="nav-panel">
    <div id="specmem-nav"></div>
</nav>
```

3. **Add scripts before closing `</body>`:**

```html
<script src="/shared-header.js"></script>
<script src="/shared-nav.js"></script>
<script src="/shared-toast.js"></script>

<script>
    // Initialize components
    const header = new SpecMemHeader({
        title: 'SPECMEM',
        subtitle: 'TACTICAL MEMORY OPERATIONS',
        showStats: true
    });

    const nav = new SpecMemNavigation({
        currentPage: 'index'
    });

    // Toast is auto-initialized as 'specmemToast'
    // Use: specmemToast.success('Operation completed!');
</script>
```

## Quick Integration for team-members.html

Same as index.html, but use:

```javascript
const nav = new SpecMemNavigation({
    currentPage: 'team-members'
});
```

## Quick Integration for Other Pages

1. **Include theme:**
   ```html
   <link rel="stylesheet" href="/shared-theme.css">
   ```

2. **Add basic structure:**
   ```html
   <body>
       <div class="main-container">
           <aside class="nav-panel">
               <div id="specmem-nav"></div>
           </aside>
           <main class="content-area">
               <!-- Your content -->
           </main>
       </div>

       <script src="/shared-header.js"></script>
       <script src="/shared-nav.js"></script>
       <script>
           new SpecMemHeader({ title: 'SPECMEM' });
           new SpecMemNavigation({ currentPage: 'your-page' });
       </script>
   </body>
   ```

3. **Add page-specific styles:**
   ```html
   <style>
       body { padding-top: 60px; }
       .main-container {
           display: grid;
           grid-template-columns: 80px 1fr;
           min-height: calc(100vh - 60px);
       }
       .content-area {
           padding: var(--spacing-lg);
       }
   </style>
   ```

## Using Toast Notifications

Toast is auto-initialized as a global `specmemToast` object:

```javascript
// Success notification
specmemToast.success('Memory saved successfully!');

// Error notification
specmemToast.error('Failed to load data');

// Warning notification
specmemToast.warning('Session will expire soon');

// Info notification
specmemToast.info('New team member connected');

// With custom options
specmemToast.success('Operation completed', {
    title: 'Success',
    duration: 3000,  // 3 seconds
    icon: '✓'
});

// Manual dismiss (duration: 0)
const toast = specmemToast.error('Critical error', { duration: 0 });
// Later: specmemToast.dismiss(toast);
```

## Using CSS Variables

Replace hardcoded values with variables:

```css
/* OLD */
color: #FFD700;
background: #1a1a1a;
padding: 16px;

/* NEW */
color: var(--csgo-yellow);
background: var(--csgo-gray);
padding: var(--spacing-md);
```

### Available Variables

**Colors:**
- `--csgo-yellow`, `--csgo-yellow-dark`, `--csgo-yellow-glow`
- `--csgo-black`, `--csgo-dark`, `--csgo-darker`
- `--csgo-gray`, `--csgo-gray-light`
- `--csgo-text`, `--csgo-text-dim`
- `--csgo-success`, `--csgo-error`, `--csgo-warning`

**Spacing:**
- `--spacing-xs` (4px), `--spacing-sm` (8px)
- `--spacing-md` (16px), `--spacing-lg` (24px)

**Transitions:**
- `--transition-fast` (0.15s), `--transition-normal` (0.3s)

**Shadows:**
- `--shadow-sm`, `--shadow-md`, `--shadow-lg`
- `--shadow-yellow`, `--shadow-yellow-strong`

## Using Utility Classes

Add to HTML instead of writing CSS:

```html
<!-- Text colors -->
<h1 class="text-yellow">Yellow heading</h1>
<p class="text-success">Success message</p>
<p class="text-error">Error message</p>

<!-- Effects -->
<div class="glow-yellow">Glowing text</div>
<div class="shadow-yellow">Yellow shadow</div>

<!-- Animations -->
<div class="fade-in">Fades in on load</div>
<div class="slide-in-up">Slides up on load</div>

<!-- Loading states (from index-improvements.css) -->
<div class="loading-skeleton" style="height: 100px;"></div>
<div class="loading-spinner"></div>

<!-- Status indicators -->
<span class="status-indicator online"></span> Online
<span class="status-indicator offline"></span> Offline
```

## Migration Checklist

For each page you modernize:

- [ ] Include `shared-theme.css`
- [ ] Include `index-improvements.css` (optional)
- [ ] Replace hardcoded colors with CSS variables
- [ ] Add shared header component
- [ ] Add shared navigation component
- [ ] Add toast notifications
- [ ] Test keyboard navigation (Tab, Arrow keys)
- [ ] Test on mobile (Chrome DevTools)
- [ ] Test on Firefox
- [ ] Verify accessibility (screen reader, keyboard only)
- [ ] Check console for errors

## Benefits Summary

### For Users
- Consistent experience across all pages
- Faster navigation
- Better mobile support
- Accessible to keyboard/screen reader users
- Smoother animations

### For Developers
- Reusable components
- Less code duplication
- Easier maintenance
- Faster development
- Modern CSS practices

## Example: Converting a Button

**Before:**
```html
<button style="background: #FFD700; color: #000; padding: 12px 24px;"
        onclick="saveData()">
    Save
</button>
```

**After:**
```html
<button class="btn btn-primary" onclick="saveData()">
    Save
</button>
```

**With toast feedback:**
```javascript
function saveData() {
    try {
        // ... save logic ...
        specmemToast.success('Data saved successfully!');
    } catch (error) {
        specmemToast.error('Failed to save: ' + error.message);
    }
}
```

## Common Patterns

### Loading State
```javascript
// Show loading
document.getElementById('myCard').classList.add('loading-skeleton');

// After data loads
document.getElementById('myCard').classList.remove('loading-skeleton');
```

### Status Indicator
```html
<div class="team-member-status">
    <span class="status-indicator online"></span>
    <span>Team Member Alpha</span>
</div>
```

### Animated Card Grid
```html
<div class="stats-grid">
    <div class="stat-card"><!-- Will auto-animate --></div>
    <div class="stat-card"><!-- Staggered animation --></div>
    <div class="stat-card"><!-- ... --></div>
</div>
```

## Testing Your Integration

1. **Visual Test:**
   - Open page in browser
   - Check header appears correctly
   - Verify navigation highlights current page
   - Test hover effects

2. **Interaction Test:**
   - Click navigation items
   - Test keyboard navigation (Tab, Arrow keys)
   - Try toast notifications

3. **Responsive Test:**
   - Resize browser to mobile size (< 480px)
   - Check navigation moves to bottom
   - Verify touch interactions work

4. **Accessibility Test:**
   - Use keyboard only (no mouse)
   - Check focus indicators visible
   - Verify ARIA labels present

## Troubleshooting

**Navigation not appearing:**
```javascript
// Check if component loaded
console.log(typeof SpecMemNavigation);
// Should output: 'function'

// Check container exists
console.log(document.getElementById('specmem-nav'));
// Should output: <div id="specmem-nav">
```

**Toast not working:**
```javascript
// Check global instance
console.log(specmemToast);
// Should output: SpecMemToast {container: div.toast-container, ...}
```

**Styles not applying:**
- Check CSS file paths are correct
- Look for 404 errors in Network tab
- Verify no conflicting styles override

## Need Help?

1. Check **DASHBOARD-README.md** for full documentation
2. Look at **example-page.html** for working example
3. Check browser console for errors
4. Test in isolated environment first

## Future Enhancements

Potential additions (not yet implemented):

- [ ] Dark/light mode toggle
- [ ] User preferences persistence
- [ ] Advanced search component
- [ ] Data visualization components
- [ ] Drag-and-drop utilities
- [ ] Advanced form validation

---

**Last Updated:** 2025-12-13
**Created By:** Beta TeamMember
**Status:** Ready for Integration
