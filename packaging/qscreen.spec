%global uuid qscreen@rossiandrea.dev

Name:           gnome-shell-extension-qscreen
Version:        0.1.0
Release:        1%{?dist}
Summary:        Tile windows into grids and mixed layouts in GNOME Shell
License:        GPL-2.0-or-later
Source0:        qscreen-%{version}.tar.gz
BuildArch:      noarch

BuildRequires:  glib2-devel
Requires:       gnome-shell >= 49

%description
QScreen rearranges the open windows into grids from 2x2 up to 4x4, rows and
columns combinations (2+1+3, main + stack, ...) and user-defined layouts, from
a top bar menu, a layout picker overlay or keyboard shortcuts.

%prep
%autosetup -n qscreen-%{version}

%build
glib-compile-schemas %{uuid}/schemas

%install
install -d %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}
cp -a %{uuid}/. %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/

%files
%license LICENSE
%doc README.md
%{_datadir}/gnome-shell/extensions/%{uuid}/

%changelog
* Tue Oct 20 2026 rad@rossiandrea.dev - 0.1.0-1
- Initial release
