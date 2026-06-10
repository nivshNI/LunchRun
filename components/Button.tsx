
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  isLoading, 
  className = '', 
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center gap-2 transition-all duration-300 antialiased active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-none outline-none";
  
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md",
    secondary: "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300",
    danger: "bg-rose-500 text-white hover:bg-rose-600",
    ghost: "text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`} 
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? <i className="fas fa-circle-notch fa-spin text-sm"></i> : children}
    </button>
  );
};
