import { useMemo } from "react";
import {
  List,
  ListItemButton,
  ListItemIcon,
  Tooltip,
  Divider,
} from "@mui/material";
import { NavLink, useLocation } from "react-router-dom";

import LogoutIcon from "@mui/icons-material/Logout";
import LockIcon from "@mui/icons-material/Lock";

import SpaceDashboardRoundedIcon from "@mui/icons-material/SpaceDashboardRounded";
import PeopleIcon from "@mui/icons-material/People";
import AreaChartRoundedIcon from "@mui/icons-material/AreaChartRounded";
import CategoryIcon from "@mui/icons-material/Category";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import PersonAddRoundedIcon from "@mui/icons-material/PersonAddRounded";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";

import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import PlaylistAddCheckRoundedIcon from "@mui/icons-material/PlaylistAddCheckRounded";
import MeetingRoomRoundedIcon from "@mui/icons-material/MeetingRoomRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import CardGiftcardRoundedIcon from "@mui/icons-material/CardGiftcardRounded";
import SummarizeRoundedIcon from "@mui/icons-material/SummarizeRounded";

import useUsbSession from "../../hooks/useUsbSession";
import styles from "./Sidebar.module.css";

function NavIconLink({ to, icon, text, end }) {
  return (
    <Tooltip title={text} placement="right" arrow>
      <ListItemButton
        component={NavLink}
        to={to}
        end={end}
        className={({ isActive }) =>
          isActive ? `${styles.item} ${styles.itemActive}` : styles.item
        }
      >
        <ListItemIcon className={styles.icon}>{icon}</ListItemIcon>
      </ListItemButton>
    </Tooltip>
  );
}

function ActionBtn({ icon, text, onClick, tone = "default" }) {
  const toneCls = tone === "danger" ? styles.itemDanger : "";
  return (
    <Tooltip title={text} placement="right" arrow>
      <ListItemButton onClick={onClick} className={`${styles.item} ${toneCls}`}>
        <ListItemIcon className={styles.icon}>{icon}</ListItemIcon>
      </ListItemButton>
    </Tooltip>
  );
}

export default function Sidebar() {
  const { role, lock } = useUsbSession();
  const location = useLocation();
  const isReception = location.pathname.startsWith("/reception");

  const navItems = useMemo(() => {
    if (isReception) {
      return [
        { to: "/reception", text: "Reception", icon: <HomeRoundedIcon />, end: true },
        { to: "/reception/checkin", text: "Check-in", icon: <PlaylistAddCheckRoundedIcon /> },
        { to: "/reception/dashboard", text: "Liveboard", icon: <MeetingRoomRoundedIcon /> },
        { to: "/reception/checkout", text: "Check-out", icon: <ReceiptLongRoundedIcon /> },
        { to: "/reception/summary", text: "Tagesübersicht", icon: <SummarizeRoundedIcon /> },
        { to: "/reception/pos", text: "Kasse", icon: <PointOfSaleIcon /> },
        { to: "/reception/vouchers", text: "Gutscheine", icon: <CardGiftcardRoundedIcon /> },
      ];
    }

    const base = [{ to: "/admin", text: "Dashboard", icon: <SpaceDashboardRoundedIcon />, end: true }];

    if (role === "admin") {
      base.push(
        { to: "/admin/staff", text: "Mitarbeiter", icon: <PeopleIcon /> },
        { to: "/admin/areas", text: "Bereiche", icon: <AreaChartRoundedIcon /> },
        { to: "/admin/catalog", text: "Katalog", icon: <CategoryIcon /> },
        { to: "/admin/customers", text: "Kunden", icon: <PersonAddRoundedIcon /> },
        { to: "/admin/reports", text: "Umsätze", icon: <LibraryBooksIcon /> },
        { to: "/admin/admin", text: "Admin", icon: <AdminPanelSettingsIcon /> },
        { to: "/admin/cashier", text: "Kasse", icon: <PointOfSaleIcon /> },
      );
    } else if (role === "cashier") {
      base.push(
        { to: "/admin/cashier", text: "Kasse", icon: <PointOfSaleIcon /> },
        { to: "/admin/customers", text: "Kunden", icon: <PersonAddRoundedIcon /> },
      );
    } else if (role === "staff") {
      base.push(
        { to: "/admin/staff", text: "Mitarbeiter", icon: <PeopleIcon /> },
        { to: "/admin/cashier", text: "Kasse", icon: <PointOfSaleIcon /> },
        { to: "/admin/customers", text: "Kunden", icon: <PersonAddRoundedIcon /> },
      );
    } else {
      base.push({ to: "/admin/cashier", text: "Kasse", icon: <PointOfSaleIcon /> });
    }

    base.push({ to: "/reception", text: "Reception", icon: <HomeRoundedIcon /> });

    return base;
  }, [role, isReception]);

  return (
    <aside className={styles.rail} aria-label="Sidebar Navigation">
      <div className={styles.inner}>
        <div className={styles.brandMark} aria-hidden="true" />

        <List className={styles.list}>
          {navItems.map((it) => (
            <NavIconLink key={it.to} {...it} />
          ))}
        </List>

        <div className={styles.grow} />
        <Divider className={styles.divider} />

        <List className={styles.list}>
          <ActionBtn text="Sperren / USB" icon={<LockIcon />} onClick={() => lock?.()} />
          <ActionBtn text="Logout" icon={<LogoutIcon />} tone="danger" onClick={() => lock?.()} />
        </List>
      </div>
    </aside>
  );
}
