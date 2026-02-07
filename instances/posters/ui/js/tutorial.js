/**
 * Tutorial Overlay System
 *
 * A click-through guided tour for the Process Images page
 */

class TutorialOverlay {
  constructor() {
    this.currentStep = 0;
    this.isActive = false;
    this.overlay = null;
    this.spotlight = null;
    this.tooltip = null;

    // Define the tutorial steps
    this.steps = [
      {
        title: 'Welcome to Image Processing',
        content: 'This guide will walk you through processing poster images. The workflow has 4 main steps that you\'ll follow in order.',
        target: '.workflow-info',
        position: 'bottom'
      },
      {
        title: 'Step 1: Select or Create a Session',
        content: 'Sessions are staging areas for your images. Select an existing session from the dropdown, or click "+ New Session" to create one. Sessions help organize batches of images before processing.',
        target: '#phase-session',
        position: 'bottom'
      },
      {
        title: 'Session Dropdown',
        content: 'Use this dropdown to switch between sessions. Each session shows how many images it contains.',
        target: '#session-select',
        position: 'bottom'
      },
      {
        title: 'Create New Session',
        content: 'Click here to create a new session. You\'ll enter a name for your session (e.g., "Concert Posters 2024" or "January Batch").',
        target: '#new-session-btn',
        position: 'bottom'
      },
      {
        title: 'Step 2: Upload Images',
        content: 'Once you have a session, you can upload images to it. Browse your local folder to select poster images.',
        target: '#upload-section',
        position: 'top'
      },
      {
        title: 'Browse Local Folder',
        content: 'Click this button to open a folder picker. Select a folder containing your poster images (JPG, PNG, etc.).',
        target: '#browse-btn',
        position: 'bottom'
      },
      {
        title: 'Local Files List',
        content: 'After selecting a folder, your images appear here. Click on images to select them, or use "Select All" to choose everything.',
        target: '#local-file-list',
        position: 'top'
      },
      {
        title: 'Upload to Session',
        content: 'Once you\'ve selected images, click this button to upload them to your current session. They\'ll be stored in the cloud ready for processing.',
        target: '#upload-to-session-btn',
        position: 'top'
      },
      {
        title: 'Step 3: Select Images for Processing',
        content: 'View and select which images from your session you want to process. You can filter by filename and select individual images or all at once.',
        target: '#session-images-section',
        position: 'top'
      },
      {
        title: 'Session Images Grid',
        content: 'Your uploaded images appear as a grid of thumbnails. Click images to select them for processing. Selected images have a blue border.',
        target: '#session-image-list',
        position: 'top'
      },
      {
        title: 'Step 4: Process Images',
        content: 'Configure processing options and start extracting metadata from your posters using AI vision models.',
        target: '#process-section',
        position: 'top'
      },
      {
        title: 'Vision Model Selection',
        content: 'Choose which AI model to use for analyzing your posters. Different models have different strengths - minicpm-v is recommended for best accuracy.',
        target: '#model-select',
        position: 'bottom'
      },
      {
        title: 'Process Selected',
        content: 'Click this button to process only the images you\'ve selected. Successfully processed images automatically move to the Live folder.',
        target: '#process-selected-btn',
        position: 'top'
      },
      {
        title: 'Processing Progress',
        content: 'When processing starts, you\'ll see a progress section with pipeline stages: Download, Extract, Store, and Live. Watch the activity log for real-time updates.',
        target: '#progress-section',
        position: 'top',
        optional: true
      },
      {
        title: 'You\'re Ready!',
        content: 'That\'s the complete workflow! Start by selecting or creating a session, upload your poster images, select which ones to process, and let the AI extract the metadata. Happy processing!',
        target: '.workflow-info',
        position: 'bottom'
      }
    ];
  }

  /**
   * Initialize the tutorial system
   */
  init() {
    this.createOverlayElements();
    this.addHelpButton();
    this.bindEvents();
    console.log('Tutorial system initialized');
  }

  /**
   * Create the overlay DOM elements
   */
  createOverlayElements() {
    // Main overlay backdrop
    this.overlay = document.createElement('div');
    this.overlay.className = 'tutorial-overlay hidden';
    this.overlay.innerHTML = `
      <div class="tutorial-backdrop"></div>
      <div class="tutorial-spotlight"></div>
      <div class="tutorial-tooltip">
        <div class="tutorial-tooltip-header">
          <span class="tutorial-step-indicator"></span>
          <button class="tutorial-close-btn" title="Close tutorial">&times;</button>
        </div>
        <h3 class="tutorial-title"></h3>
        <p class="tutorial-content"></p>
        <div class="tutorial-nav">
          <button class="tutorial-btn tutorial-prev-btn">Previous</button>
          <button class="tutorial-btn tutorial-next-btn">Next</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Cache references
    this.spotlight = this.overlay.querySelector('.tutorial-spotlight');
    this.tooltip = this.overlay.querySelector('.tutorial-tooltip');
    this.titleEl = this.overlay.querySelector('.tutorial-title');
    this.contentEl = this.overlay.querySelector('.tutorial-content');
    this.stepIndicator = this.overlay.querySelector('.tutorial-step-indicator');
    this.prevBtn = this.overlay.querySelector('.tutorial-prev-btn');
    this.nextBtn = this.overlay.querySelector('.tutorial-next-btn');
    this.closeBtn = this.overlay.querySelector('.tutorial-close-btn');
  }

  /**
   * Add the help button to the workflow info section
   */
  addHelpButton() {
    const workflowInfo = document.querySelector('.workflow-info');
    if (!workflowInfo) return;

    const helpBtn = document.createElement('button');
    helpBtn.className = 'tutorial-help-btn';
    helpBtn.innerHTML = '? Help';
    helpBtn.title = 'Start guided tour';
    helpBtn.addEventListener('click', () => this.start());

    // Find or create a container for the button
    const workflowSteps = workflowInfo.querySelector('.workflow-steps');
    if (workflowSteps) {
      workflowInfo.style.position = 'relative';
      workflowInfo.appendChild(helpBtn);
    }
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    this.prevBtn?.addEventListener('click', () => this.prev());
    this.nextBtn?.addEventListener('click', () => this.next());
    this.closeBtn?.addEventListener('click', () => this.stop());

    // Close on backdrop click
    this.overlay.querySelector('.tutorial-backdrop')?.addEventListener('click', () => this.stop());

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.isActive) return;

      if (e.key === 'Escape') {
        this.stop();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        this.next();
      } else if (e.key === 'ArrowLeft') {
        this.prev();
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      if (this.isActive) {
        this.positionSpotlight();
      }
    });
  }

  /**
   * Start the tutorial
   */
  start() {
    this.currentStep = 0;
    this.isActive = true;
    this.overlay.classList.remove('hidden');
    document.body.classList.add('tutorial-active');
    this.showStep();
  }

  /**
   * Stop the tutorial
   */
  stop() {
    this.isActive = false;
    this.overlay.classList.add('hidden');
    document.body.classList.remove('tutorial-active');
    this.spotlight.style.opacity = '0';
  }

  /**
   * Go to next step
   */
  next() {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      this.showStep();
    } else {
      this.stop();
    }
  }

  /**
   * Go to previous step
   */
  prev() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.showStep();
    }
  }

  /**
   * Show the current step
   */
  showStep() {
    const step = this.steps[this.currentStep];
    if (!step) return;

    // Find target element
    let targetEl = document.querySelector(step.target);

    // Skip optional steps if target doesn't exist or is hidden
    if (step.optional && (!targetEl || targetEl.classList.contains('hidden'))) {
      this.next();
      return;
    }

    // Update content
    this.titleEl.textContent = step.title;
    this.contentEl.textContent = step.content;
    this.stepIndicator.textContent = `${this.currentStep + 1} of ${this.steps.length}`;

    // Update navigation buttons
    this.prevBtn.style.visibility = this.currentStep === 0 ? 'hidden' : 'visible';
    this.nextBtn.textContent = this.currentStep === this.steps.length - 1 ? 'Finish' : 'Next';

    // Position spotlight and tooltip
    this.positionSpotlight(targetEl, step.position);

    // Scroll target into view if needed
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Position the spotlight around the target element
   */
  positionSpotlight(targetEl, position = 'bottom') {
    if (!targetEl) {
      // No target - center the tooltip
      this.spotlight.style.opacity = '0';
      this.tooltip.style.top = '50%';
      this.tooltip.style.left = '50%';
      this.tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const padding = 8;

    // Position spotlight
    this.spotlight.style.opacity = '1';
    this.spotlight.style.top = `${rect.top - padding + window.scrollY}px`;
    this.spotlight.style.left = `${rect.left - padding}px`;
    this.spotlight.style.width = `${rect.width + padding * 2}px`;
    this.spotlight.style.height = `${rect.height + padding * 2}px`;

    // Position tooltip based on position preference
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const tooltipHeight = tooltipRect.height || 200;
    const tooltipWidth = tooltipRect.width || 350;
    const margin = 20;

    let top, left;

    switch (position) {
      case 'top':
        top = rect.top + window.scrollY - tooltipHeight - margin;
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        break;
      case 'bottom':
        top = rect.bottom + window.scrollY + margin;
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        break;
      case 'left':
        top = rect.top + window.scrollY + (rect.height / 2) - (tooltipHeight / 2);
        left = rect.left - tooltipWidth - margin;
        break;
      case 'right':
        top = rect.top + window.scrollY + (rect.height / 2) - (tooltipHeight / 2);
        left = rect.right + margin;
        break;
      default:
        top = rect.bottom + window.scrollY + margin;
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
    }

    // Keep tooltip within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < margin) left = margin;
    if (left + tooltipWidth > viewportWidth - margin) left = viewportWidth - tooltipWidth - margin;
    if (top < margin) top = rect.bottom + window.scrollY + margin; // Flip to bottom
    if (top + tooltipHeight > window.scrollY + viewportHeight - margin) {
      top = rect.top + window.scrollY - tooltipHeight - margin; // Flip to top
    }

    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.transform = 'none';
  }
}

// Create and export singleton
export const tutorial = new TutorialOverlay();
