UUID     = calendarium@kami911
LOCALEDIR = $(HOME)/.local/share/locale
DESKLETDIR = $(HOME)/.local/share/cinnamon/desklets/$(UUID)

POFILES  = $(wildcard *.po)
LANGS    = $(POFILES:.po=)

.PHONY: all install clean pot

all: $(LANGS:%=../locale/%/LC_MESSAGES/$(UUID).mo)

../locale/%/LC_MESSAGES/$(UUID).mo: %.po
	@mkdir -p $(dir $@)
	msgfmt -o $@ $<

install: all
	@for lang in $(LANGS); do \
		mkdir -p $(LOCALEDIR)/$$lang/LC_MESSAGES; \
		cp ../locale/$$lang/LC_MESSAGES/$(UUID).mo \
		   $(LOCALEDIR)/$$lang/LC_MESSAGES/$(UUID).mo; \
		echo "Installed $$lang"; \
	done

pot:
	cd .. && cinnamon-spices-makepot $(UUID) || true

clean:
	rm -f ../locale/*/LC_MESSAGES/$(UUID).mo
