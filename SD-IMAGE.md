# Pizza Ranch display SD image

This image is for a Raspberry Pi 3 B+ and creates a direct cloud display. No terminal commands are needed at the restaurant.

## Prepare a card

1. Download `Pizza-Ranch-Display-32bit.img.xz` from the newest `SD Image` release on GitHub.
2. Open Raspberry Pi Imager, choose **Use custom**, and select the downloaded file.
3. Select the SD card. In OS customization, enter the restaurant Wi-Fi name, password, Wi-Fi country, and timezone. Leave SSH disabled.
4. Write the card, insert it into the Pi, connect HDMI, and turn the Pi on. Ethernet also works without Wi-Fi setup.
5. The first boot can take 10–20 minutes while Raspberry Pi OS installs updates. The Pi reboots automatically.
6. Scan the QR code on the TV. Sign in at `display.projectaimnet.com`, select the location, name the TV, and choose **Add TV**.
7. The Pi immediately checks GitHub for the newest display release. It then loads the page or marketing campaign selected in the cloud controller.

The QR code contains only the HTTPS setup address and a short-lived six-digit code. It never contains a password or device credential. A code expires after 30 minutes and can only be used by an authenticated user who has display-management permission.

## Build a new image

In GitHub, open **Actions**, choose **Build Raspberry Pi SD image**, and select **Run workflow**. A successful run publishes a new GitHub release containing the compressed image and SHA-256 checksum.

