#!/bin/bash -e
install -d -m 755 "${ROOTFS_DIR}/usr/local/lib/pizza-ranch-firstboot"
install -m 755 files/firstboot.sh "${ROOTFS_DIR}/usr/local/sbin/pizza-ranch-firstboot"
install -m 644 files/pizza-ranch-firstboot.service "${ROOTFS_DIR}/etc/systemd/system/pizza-ranch-firstboot.service"
install -m 644 files/Pizza-Ranch-Kiosk.zip "${ROOTFS_DIR}/usr/local/lib/pizza-ranch-firstboot/Pizza-Ranch-Kiosk.zip"
ln -sf /etc/systemd/system/pizza-ranch-firstboot.service \
  "${ROOTFS_DIR}/etc/systemd/system/multi-user.target.wants/pizza-ranch-firstboot.service"

# Every flashed card creates its own machine identity on first boot.
truncate -s 0 "${ROOTFS_DIR}/etc/machine-id"
rm -f "${ROOTFS_DIR}/var/lib/dbus/machine-id"

# The kiosk has no need for inbound shell access. An owner can enable SSH later.
rm -f "${ROOTFS_DIR}/boot/ssh" "${ROOTFS_DIR}/boot/firmware/ssh"

