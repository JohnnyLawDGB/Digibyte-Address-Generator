################################################################################
#
# holdfast-node: official Node.js binary, pinned by hash
#
################################################################################

HOLDFAST_NODE_VERSION = 22.23.5
HOLDFAST_NODE_SOURCE = node-v$(HOLDFAST_NODE_VERSION)-linux-arm64.tar.xz
HOLDFAST_NODE_SITE = https://nodejs.org/dist/v$(HOLDFAST_NODE_VERSION)
HOLDFAST_NODE_LICENSE = MIT (core), others (bundled dependencies)
HOLDFAST_NODE_LICENSE_FILES = LICENSE

define HOLDFAST_NODE_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/bin/node $(TARGET_DIR)/usr/bin/node
endef

$(eval $(generic-package))
