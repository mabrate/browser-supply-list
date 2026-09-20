# Browser Supply List Extension

An unpacked Manifest V3 Chrome extension that keeps a Google Sheets worksheet as a cross-store purchasing list. It reads the destination sheet's first-row headers, extracts general product metadata from the current page, detects a matching item by normalized URL or product ID, and appends, updates, or removes only the matched row.

Browser Supply List turns a Google Sheets worksheet into a practical supply and purchasing list while you shop online. Keep the extension side panel open as you browse product pages: it reads useful product details such as the item name, price, vendor, image, product ID, and link, then lets you review and save the item directly to your chosen worksheet.

The extension works across shopping sites and includes extra support for Amazon product pages. It recognizes products already saved to the selected worksheet, helping prevent duplicate entries and giving you the option to update or remove the matching item instead.

You decide which spreadsheet columns appear while shopping. Fields stay editable, and less useful columns can be hidden from the side panel without changing your sheet. Your selected worksheet, field mappings, and visibility settings are remembered between browser sessions.

## One-time Google setup

1. In Google Cloud Console, create a project and enable the **Google Sheets API**.
2. Create an OAuth client of type **Chrome extension**, using the extension ID Chrome gives this unpacked extension. (For development, load it once to obtain the ID.)
3. Replace the `client_id` placeholder in `extension/manifest.json` with that client ID, then reload the extension. The OAuth client must be of type **Chrome Extension** and its Item ID must exactly match the ID shown for this extension at `chrome://extensions`.
4. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension` folder.

To create a `.crx`, use **Pack extension** in the same Chrome page and choose the `extension` folder. Chrome writes the resulting `.crx` and private key beside that folder, at this project root. Keep the private key out of version control and somewhere secure.

The extension requests only Sheets access and uses the worksheet `gid` from the pasted URL for every read, write, and deletion. It never chooses a different tab in the same workbook.

## Use

Create a header row in the target worksheet, open the extension side panel, paste the exact worksheet URL, and click **Connect**. Suggested header names such as Item Name, Price, Vendor, URL, Image, SKU, and Description are auto-mapped; every value remains editable. Use **Refresh page data** after navigating, then Add, Update, or Remove the matched product.

The mapping formulas are simple page-data keys in this version (`title`, `price`, `url`, `canonicalUrl`, `vendor`, `image`, `productId`, `description`). The sidebar labels a value as automatic or manual. Mapping persistence plumbing is included; custom mapping editing is the next UI addition.

## Test checklist

- Load unpacked and confirm the side panel opens from the extension action.
- Connect a test worksheet URL whose header row is populated; authorize Google when prompted.
- Add a product, reload its page, and confirm it becomes **ALREADY IN SHEET**.
- Change a value, update it, then remove it and confirm only that row was deleted.
- Test a page with no structured price and confirm the price warning is shown.

## Public-release checklist

### Completed in this project

- The extension has no remote JavaScript or WebAssembly.
- Broad `<all_urls>` access has been removed.
- Shopping-site access is now an optional, per-site permission requested only when the user clicks **Allow this shopping site**.
- A first-use privacy disclosure and affirmative consent gate now appear before Sheet access.
- `extension/PRIVACY.md` documents local storage, page-data use, Google Sheets use, and Google API Limited Use.

### You must do before publishing

1. Host the text in `extension/PRIVACY.md` at a public HTTPS URL you control. Replace the effective date and contact placeholder first, then enter that URL in the Chrome Web Store privacy-policy field.
2. In the Chrome Web Store Developer Dashboard, create the listing and prepare its description, screenshots, and permission justifications. Complete the store’s data-use disclosures accurately: product page data and Google Sheets data are used only for the supply-list feature and are not sold or used for advertising.
3. Create a production OAuth client of type **Chrome Extension** in the Google Cloud project after you know the Store extension ID. Set that exact ID as the client’s Item ID, replace `oauth2.client_id` in `extension/manifest.json`, and reload/test the packaged extension. Enable the Google Sheets API and configure the OAuth consent screen for production.
4. Complete any Google OAuth verification requested for the Sheets scope before inviting outside users.
5. Test the packaged Store candidate, not only the unpacked development copy: privacy consent, first site-access request, Google authorization, a private Sheet, a missing worksheet, duplicate detection, add/update/remove, authorization expiration, and permission warnings.
6. Do not publish the OAuth client secret, Chrome Web Store private key, or any test spreadsheet containing private information.

### Suggested store disclosure

“Browser Supply List reads product information from shopping sites you choose to allow and saves the values you approve to the Google Sheets worksheet you select. It does not use advertising, analytics, or developer-operated servers.”
