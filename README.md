# Personal Pixel Art Canvas

Welcome! 👋 This is a free tool that transforms your large Aseprite projects into a high-performance website, allowing you to view your art conveniently on any device.

This project works like a "smart map": it slices your huge canvas into thousands of small pieces and loads only the ones visible on the screen. This allows you to display artwork of any size without lag.

---

## 🚀 Your Dashboard

Here, you can monitor your website's status and find the link to it.

| Build Status | Your Website URL |
| :---: | :---: |
| [![Build Status](https://github.com/${{ github.repository }}/actions/workflows/deploy.yml/badge.svg)](https://github.com/${{ github.repository }}/actions) | **[https://${{ github.repository_owner }}.github.io/${{ github.event.repository.name }}/](https://${{ github.repository_owner }}.github.io/${{ github.event.repository.name }}/)** |

* **Green checkmark ✅** means your canvas has been successfully processed and published.
* **Yellow circle 🟡** means the robot is currently working. Please wait 2-3 minutes.
* **Red cross ❌** means an error has occurred. Click the badge to see the logs.

---

## 🎨 How to Update Your Canvas

Your entire workflow is just **one simple action**: uploading your Aseprite project file.

[➡️ Click Here to Upload Your File](https://github.com/${{ github.repository }}/upload/main/source)

**Simple Instructions:**

1.  Click the link above. You will be taken to the upload page.
2.  Drag and drop your Aseprite project file into the browser window. **Important:** The file must be named **`canvas.aseprite`**.
3.  Click the green "Commit changes" button.
4.  Wait 2-3 minutes for the status badge in the Dashboard above to turn green ✅.
5.  Done! Your website has been updated automatically.

---

## 🛠️ Getting Started: One-Time Setup

If you are using this template for the first time, you need to follow three simple steps to get everything working.

### Step 1: Create a GitHub Account

If you don't have an account yet, it only takes a minute.

* Go to **[github.com](https://github.com)** and sign up. It's free.

### Step 2: Create Your Site from This Template

* While on this repository's page, click the big green **"Use this template"** button in the top-right corner.
* Select **"Create a new repository"**.
* Choose a simple name for your project (e.g., `my-art-gallery`).
* Make sure the repository is set to **Public**.
* Click **"Create repository"**. Done! You now have a personal copy of this tool.

### Step 3: Enable Your Website

You only need to do this once.

1.  In your new repository, go to **Settings**.
2.  In the left menu, select the **Pages** section.
3.  Under the "Source" section, select **`gh-pages`** from the dropdown menu and click **Save**.
4.  Wait a couple of minutes. The page will refresh, and a green banner with your site's link will appear at the top.

**Congratulations, your site is ready!** You can now update it by following the instructions in the "How to Update Your Canvas" section.

### 👥 Authors
This project was brought to life through the collaboration of:

mozik24 - Idea and testing.

Gemini (Google AI) - Code and automation.
