import { useState, useEffect, useRef } from "react";
import {
  Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Divider, Tooltip, IconButton, useMediaQuery, Box
} from "@mui/material";
import { NavLink } from "react-router-dom";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import HomeIcon from "@mui/icons-material/Home";
import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded';
import AreaChartRoundedIcon from '@mui/icons-material/AreaChartRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import PeopleIcon from "@mui/icons-material/People";
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import CategoryIcon from '@mui/icons-material/Category';
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import LockIcon from "@mui/icons-material/Lock";
import useUsbSession from "../../hooks/useUsbSession";
import styles from "./SideBar.module.css";

/** ----------- Helpers ----------- */
function SidebarNavLink({ open = true, to, icon, text, end, onExpand }) {
  return (
    <Tooltip title={!open ? text : ""} placement="right">
      <ListItemButton
        component={NavLink}
        to={to}
        end={end}
        className={({ isActive }) =>
          isActive ? styles.activeItem : styles.item
        }
        onClick={onExpand} // expand when clicked
      >
        <ListItemIcon className={styles.icon}>{icon}</ListItemIcon>
        <ListItemText
          primary={text}
          className={open ? styles.textShow : styles.textHide}
        />
      </ListItemButton>
    </Tooltip>
  );
}

function SidebarItem({ open = true, icon, text, onClick }) {
  return (
    <Tooltip title={!open ? text : ""} placement="right">
      <ListItemButton onClick={onClick} className={styles.item}>
        <ListItemIcon className={styles.icon}>{icon}</ListItemIcon>
        <ListItemText
          primary={text}
          className={open ? styles.textShow : styles.textHide}
        />
      </ListItemButton>
    </Tooltip>
  );
}

/** ----------- Main Sidebar ----------- */
export default function SideBar({ onHome, onDashboard, onStaff, onCashier, onAdmin }) {
  const { role, staffName, usbPresent, lock } = useUsbSession();
  const isMobile = useMediaQuery("(max-width:900px)");
  const [expanded, setExpanded] = useState(false);
  const sidebarRef = useRef(null);

  /** Desktop: Click outside to close */
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        expanded &&
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target)
      ) {
        setExpanded(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  /** ----------- Mobile Drawer ----------- */
  if (isMobile) {
    return (
      <>
        <IconButton className={styles.menuBtn} onClick={() => setExpanded(true)}>
          <MenuIcon />
        </IconButton>

        <Drawer open={expanded} onClose={() => setExpanded(false)}>
          <div className={styles.mobileDrawer}>
            <List>
              <SidebarItem text="Home" icon={<HomeIcon />} onClick={() => { onHome(); setExpanded(false); }} />
              {role === "admin" && (
                <>
                  <SidebarItem text="Dashboard" icon={<SpaceDashboardRoundedIcon />} onClick={() => { onDashboard(); setExpanded(false); }} />
                  <SidebarItem text="Mitarbeiter" icon={<PeopleIcon />} onClick={() => { onStaff(); setExpanded(false); }} />
                  <SidebarItem text="Admin" icon={<AdminPanelSettingsIcon />} onClick={() => { onAdmin(); setExpanded(false); }} />
                </>
              )}
              {role === "cashier" && (
                <SidebarItem text="Kasse" icon={<PointOfSaleIcon />} onClick={() => { onCashier(); setExpanded(false); }} />
              )}
              {role === "staff" && (
                <SidebarItem text="Mitarbeiter" icon={<PeopleIcon />} onClick={() => { onStaff(); setExpanded(false); }} />
              )}
            </List>

            <Divider />
            <List>
              <SidebarItem text="Sperren / USB" icon={<LockIcon />} onClick={() => { lock?.(); setExpanded(false); }} />
            </List>

            <div className={styles.sessionBox}>
              <div>USB: {usbPresent ? "aktiv" : "kein"}</div>
              <div>Rolle: {role || "guest"}</div>
              {staffName && <div>User: {staffName}</div>}
            </div>
          </div>
        </Drawer>
      </>
    );
  }

  /** ----------- Desktop Sidebar ----------- */
  return (
    <Box ref={sidebarRef} className={expanded ? styles.open : styles.closed}>
      <Drawer variant="permanent" classes={{ paper: styles.drawer }}>
        <div className={styles.spacer} />

        <List>
          <SidebarNavLink
            open={expanded}
            to="/admin"
            end
            text="Dashboard"
            icon={<SpaceDashboardRoundedIcon />}
            onExpand={() => setExpanded(true)}
          />
          {role === "admin" && (
            <>
              <SidebarNavLink open={expanded} to="/admin/staff" text="Mitarbeiter" icon={<PeopleIcon />} onExpand={() => setExpanded(true)} />
              <SidebarNavLink open={expanded} to="/admin/areas" text="Bereiche" icon={<AreaChartRoundedIcon />} onExpand={() => setExpanded(true)} />
              <SidebarNavLink open={expanded} to="/admin/catalog" text="Katalog" icon={<CategoryIcon />} onExpand={() => setExpanded(true)} />
              <SidebarNavLink open={expanded} to="/admin/customers" text="Kunden" icon={<PersonAddRoundedIcon />} onExpand={() => setExpanded(true)} />
              <SidebarNavLink open={expanded} to="/admin/reports" text="Umsätze" icon={<LibraryBooksIcon />} onExpand={() => setExpanded(true)} />
            </>
          )}
          {role === "cashier" && (
            <>
              <SidebarNavLink open={expanded} to="/admin/cashier" text="Kasse" icon={<PointOfSaleIcon />} onExpand={() => setExpanded(true)} />
              <SidebarNavLink open={expanded} to="/admin/customers" text="Kunden" icon={<PersonAddRoundedIcon />} onExpand={() => setExpanded(true)} />
            </>
          )}
          {role === "staff" && (
            <>
              <SidebarNavLink open={expanded} to="/admin/staff" text="Mitarbeiter" icon={<PeopleIcon />} onExpand={() => setExpanded(true)} />
              <SidebarNavLink open={expanded} to="/admin/cashier" text="Kasse" icon={<PointOfSaleIcon />} onExpand={() => setExpanded(true)} />
              <SidebarNavLink open={expanded} to="/admin/customers" text="Kunden" icon={<PersonAddRoundedIcon />} onExpand={() => setExpanded(true)} />
            </>
          )}
        </List>

        <Divider />

        <List>
          <SidebarItem open={expanded} text="Sperren / USB" icon={<LockIcon />} onClick={() => lock?.()} />
        </List>

        {expanded && (
          <div className={styles.sessionBox}>
            <div>USB: {usbPresent ? "aktiv" : "kein"}</div>
            <div>Rolle: {role || "guest"}</div>
            {staffName && <div>User: {staffName}</div>}
          </div>
        )}

        <div className={styles.grow} />
        <Divider />
        <List>
          <SidebarItem open={expanded} text="Logout" icon={<LogoutIcon />} onClick={() => lock?.()} />
        </List>
      </Drawer>
    </Box>
  );
}
