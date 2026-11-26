################################################################################
#
# holdfast-vault: the cold-storage tool and its console session
#
################################################################################

HOLDFAST_VAULT_VERSION = local
HOLDFAST_VAULT_SITE = $(BR2_EXTERNAL_HOLDFAST_PATH)/../dist
HOLDFAST_VAULT_SITE_METHOD = local
HOLDFAST_VAULT_LICENSE = MIT

# Refuse to ship a bundle that does not match the committed checksums.
define HOLDFAST_VAULT_BUILD_CMDS
	cd $(@D) && sha256sum -c SHA256SUMS
endef

define HOLDFAST_VAULT_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0444 $(@D)/dgb-coldprep.cjs $(TARGET_DIR)/opt/holdfast/dgb-coldprep.cjs
	$(INSTALL) -D -m 0444 $(@D)/SHA256SUMS $(TARGET_DIR)/opt/holdfast/SHA256SUMS
endef

$(eval $(generic-package))
