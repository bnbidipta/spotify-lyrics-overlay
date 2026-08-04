document.addEventListener('DOMContentLoaded', () => {
    // 1. OS Detection logic
    const primaryDownloadBtn = document.getElementById('primary-download-btn');
    const btnText = document.getElementById('btn-text');
    const osHint = document.getElementById('os-detect-hint');

    const userAgent = navigator.userAgent.toLowerCase();
    const isWindows = userAgent.includes('win');
    const isMac = userAgent.includes('mac');
    const isLinux = userAgent.includes('linux');

    const latestReleaseUrl = 'https://github.com/bnbidipta/spotify-lyrics-overlay/releases/latest';

    if (isWindows) {
        btnText.innerText = 'Download for Windows x64 (v2.8.0)';
        primaryDownloadBtn.href = latestReleaseUrl;
        osHint.innerHTML = '⚡ Direct Installer (.exe) & Standalone Zip (.zip) • ~1.9 MB Size';
    } else if (isMac) {
        btnText.innerText = 'View GitHub Releases (macOS coming soon)';
        primaryDownloadBtn.href = latestReleaseUrl;
        osHint.innerHTML = '⚠️ Currently targeted for Windows 10/11. macOS build available via Wine/Proton or source.';
    } else if (isLinux) {
        btnText.innerText = 'View Releases for Linux';
        primaryDownloadBtn.href = latestReleaseUrl;
        osHint.innerHTML = '🐧 Linux users can run via Wine/Neutralino. Neutralino binary available on GitHub.';
    }

    // 2. FAQ Accordion toggle
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const questionBtn = item.querySelector('.faq-question');
        questionBtn.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            
            // Close all
            faqItems.forEach(otherItem => otherItem.classList.remove('active'));

            // Toggle clicked
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });

    // Open first FAQ item by default
    if (faqItems.length > 0) {
        faqItems[0].classList.add('active');
    }

    // 3. Simulated Live Lyrics Animation Mockup Loop
    const demoLyrics = [
        { prev: "I've been on my own for long enough", current: "I said, ooh, I'm blinded by the lights", next: "No, I can't sleep until I feel your touch" },
        { prev: "I said, ooh, I'm blinded by the lights", current: "No, I can't sleep until I feel your touch", next: "When I'm like this, you're the one I trust" },
        { prev: "No, I can't sleep until I feel your touch", current: "When I'm like this, you're the one I trust", next: "Hey, hey, hey..." }
    ];

    let currentDemoIndex = 0;
    const prevLineEl = document.querySelector('.mockup-lyric-line.dim:first-child');
    const activeLineEl = document.querySelector('.mockup-lyric-line.active');
    const nextLineEl = document.querySelector('.mockup-lyric-line.dim:last-child');

    if (prevLineEl && activeLineEl && nextLineEl) {
        setInterval(() => {
            currentDemoIndex = (currentDemoIndex + 1) % demoLyrics.length;
            const data = demoLyrics[currentDemoIndex];

            prevLineEl.textContent = data.prev;
            activeLineEl.textContent = data.current;
            nextLineEl.textContent = data.next;
        }, 4000);
    }
});
