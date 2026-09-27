export function initContactForm() {
  const form = document.getElementById('contactForm');
  const statusMsg = document.getElementById('formStatus');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Sending...';
    submitBtn.disabled = true;

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Mock API call to demonstrate modern async behavior
    try {
      await new Promise(resolve => setTimeout(resolve, 1200));
      statusMsg.style.color = '#10b981';
      statusMsg.textContent = 'Message sent successfully!';
      form.reset();
    } catch (err) {
      statusMsg.style.color = '#ef4444';
      statusMsg.textContent = 'An error occurred. Please try again.';
    } finally {
      submitBtn.textContent = 'Send Message';
      submitBtn.disabled = false;
    }
  });
}