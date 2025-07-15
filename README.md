# Tomato Harvest Tracker

A mobile-friendly web application to track your tomato harvests throughout the season.

## Setup Instructions

### Prerequisites

- Node.js installed
- npm or yarn installed
- A Google account

### Automated Setup

1. Install the required dependencies:
```bash
npm install
```

2. Run the setup script:
```bash
npm run setup
```

3. Follow the prompts in the automated browser:
   - Sign in to your Google account if prompted
   - The script will create a new Google Sheet named "Tomato Harvest Tracker"
   - It will open the Apps Script editor and add the necessary code
   - Follow the on-screen instructions to deploy the script as a web app
   - Copy the web app URL when provided

4. Update the HTML file with your script URL:
   - Open `index.html` in a text editor
   - Replace `TO_BE_REPLACED_WITH_ACTUAL_SCRIPT_URL` with your copied URL
   - Save the file

### Manual Setup (if automated setup fails)

1. Create a new Google Sheet
2. Go to Extensions > Apps Script
3. Copy and paste the code from `google-apps-script.js` into the editor
4. Save the project and name it "Tomato Harvest Tracker"
5. Click on "Deploy" > "New deployment"
6. Select "Web app" as the deployment type
7. Set "Execute as" to "Me"
8. Set "Who has access" to "Anyone" (or "Anyone with Google account" for more security)
9. Click "Deploy"
10. Copy the web app URL that's provided
11. Open `index.html` in a text editor and replace `TO_BE_REPLACED_WITH_ACTUAL_SCRIPT_URL` with your URL

## Using the Tracker

1. Open `index.html` in a web browser
2. Select who is harvesting (Jed or Ryan)
3. Start typing a tomato variety name in the dropdown
4. Enter the quantity harvested
5. As you fill in each row, a new blank row will appear automatically
6. Click "Submit Harvest" when done

The data will be automatically saved to your Google Sheet with the current date and time.

## Tomato Varieties

The following tomato varieties are included in the tracker:

- Alice's Dream
- Amish Paste
- Big Zac
- Black Cherry
- Blush
- Captain Lucky
- Casey's Pure Yellow
- Cherokee Purple
- D Amy's Ohio
- D Awesome
- D CC McGee
- D Parfait
- D Perfect Harmony
- D Sonrojo Monster
- D Suz's Beauty
- D Uluru Ochre
- Green Giant
- Lillian Cherokee (F1)
- Lillian Cherokee (F2)
- Mexico Midget
- Mortgage Lifter
- Norfolk Purple
- Phoenix
- Pink Brandywine
- Polish
- SunGold
- Sweet Million