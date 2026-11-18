# Security Specification & Access Model — مكتبة الطيب أحسن

## 1. Collaborative Store-Device Access & Owner Vault Controls

1. **Multi-Device Store Sync (All Unlocked Store Devices)**:
   - Any unlocked store device can read `products`, `shortages`, `invoices`, and `settings` so store prices, sales invoices, and the shortage notebook sync live across every cashier and owner device.
   - Any unlocked store device can `create` new missing products (`incoming().id == productId` with schema bounds), `create` new invoices, and `create`/`update` allowed shortage fields (`name`, `quantity`, `category`, `done`, `notes`, `updatedAt`).

2. **Owner-Protected Sensitive Mutations (`isAdmin()` + `email_verified == true`)**:
   - Updating or deleting existing `products`, updating or deleting `invoices`, deleting `shortages`, modifying `settings/main`, and writing to `admins` or `authorized_emails` are strictly restricted to verified store owner (`www.abdo01021221343@gmail.com` or `/admins/{uid}`).
   - All admin checks require `request.auth != null && request.auth.token.email != null && request.auth.token.email_verified == true`.

3. **Daily Cloud Backups & 30-Day Trash Bin**:
   - Any unlocked store device can check/save today's dated snapshot (`cloud_backups/daily_YYYY_MM_DD` with `reason == 'auto_daily'`) and its bounded chunks so daily backups never depend on having the owner's device online.
   - Listing all cloud backups, reading/restoring/downloading chunks (which contain secret wholesale prices), creating manual or pre-wipe backups, deleting backups, and full `trash_bin` access are strictly restricted to verified store owner (`isAdmin()`).

4. **Strict Document & ID Validation**:
   - Every collection enforces `isValidId()` regex guards (`^[a-zA-Z0-9_\-]+$`), `hasOnly(...)` schema allowlists, bounded array sizes (e.g., `items.size() <= 500`, `chunkIndex <= 200`), and non-negative numeric checks (`price >= 0`, `quantity >= 1`).
